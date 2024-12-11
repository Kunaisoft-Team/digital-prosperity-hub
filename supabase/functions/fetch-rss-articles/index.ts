// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parse as parseXML } from "https://deno.land/x/xml@2.1.1/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      headers: corsHeaders,
      status: 204,
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    })
  }

  try {
    console.log('Starting RSS feed processing')
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: sources, error: sourcesError } = await supabase
      .from('rss_sources')
      .select('*')
      .eq('active', true)

    if (sourcesError) {
      console.error('Error fetching RSS sources:', sourcesError)
      throw new Error('Failed to fetch RSS sources')
    }

    console.log(`Processing ${sources?.length || 0} RSS sources`)
    
    const results = []
    
    for (const source of sources || []) {
      try {
        console.log(`Fetching RSS feed: ${source.name} (${source.url})`)
        
        // Add specific User-Agent headers for different sources
        const headers = {
          'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0; +https://www.example.com/bot)',
          'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml',
        }

        // Add specific headers for OpenAI blog
        if (source.url.includes('openai.com')) {
          headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        const response = await fetch(source.url, { headers })
        
        if (!response.ok) {
          console.error(`HTTP error fetching ${source.name}: ${response.status} - ${response.statusText}`)
          results.push({ 
            source: source.name, 
            status: 'error', 
            message: `HTTP error! status: ${response.status} - ${response.statusText}` 
          })
          continue
        }
        
        const xml = await response.text()
        
        try {
          const parsedXML = parseXML(xml)
          
          // Check if we have a valid RSS structure
          if (!parsedXML?.rss?.channel) {
            throw new Error('Invalid RSS feed structure')
          }
          
          // Extract feed entries from the parsed XML
          const entries = parsedXML.rss.channel.item || []
          
          console.log(`Successfully parsed feed: ${source.name} with ${entries.length} entries`)
          results.push({ 
            source: source.name, 
            status: 'success',
            entries: entries.length
          })

          const { error: updateError } = await supabase
            .from('rss_sources')
            .update({ last_fetch_at: new Date().toISOString() })
            .eq('id', source.id)

          if (updateError) {
            console.error(`Error updating last_fetch_at for ${source.name}:`, updateError)
          }
        } catch (parseError) {
          console.error(`Error parsing XML for ${source.name}:`, parseError)
          results.push({ 
            source: source.name, 
            status: 'error', 
            message: `XML parsing error: ${parseError.message}` 
          })
        }

      } catch (error) {
        console.error(`Error processing source ${source.name}:`, error)
        results.push({ 
          source: source.name, 
          status: 'error', 
          message: error.message 
        })
      }
    }

    return new Response(
      JSON.stringify({ 
        message: 'RSS feeds processed', 
        results 
      }),
      {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error in RSS feed processing:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process RSS feeds', 
        details: error.message 
      }),
      {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        },
        status: 500,
      }
    )
  }
})