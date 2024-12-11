// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Parser } from 'https://deno.land/x/rss@1.0.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      headers: corsHeaders,
      status: 204,
    })
  }

  try {
    console.log('Starting RSS feed processing endpoint')
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get active RSS sources
    const { data: sources, error: sourcesError } = await supabase
      .from('rss_sources')
      .select('*')
      .eq('active', true)

    if (sourcesError) {
      console.error('Error fetching RSS sources:', sourcesError)
      throw new Error('Failed to fetch RSS sources')
    }

    console.log(`Found ${sources?.length || 0} active RSS sources`)
    
    // Process each source
    const results = []
    for (const source of sources || []) {
      try {
        console.log(`Processing source: ${source.name} (${source.url})`)
        
        const response = await fetch(source.url)
        if (!response.ok) {
          results.push({ 
            source: source.name, 
            status: 'error', 
            message: `HTTP error! status: ${response.status}` 
          })
          continue
        }
        
        const xml = await response.text()
        const parser = new Parser()
        const feed = await parser.parse(xml)
        
        results.push({ 
          source: source.name, 
          status: 'success',
          entries: feed.entries?.length || 0 
        })

        // Update last fetch time
        await supabase
          .from('rss_sources')
          .update({ last_fetch_at: new Date().toISOString() })
          .eq('id', source.id)

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
        message: 'RSS feeds processed successfully', 
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
    console.error('Error processing RSS feeds:', error)
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