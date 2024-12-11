import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parse as parseXML } from "https://deno.land/x/xml@2.1.1/mod.ts";
import { corsHeaders } from './utils/cors.ts';

// List of excluded RSS sources that are known to cause issues
const EXCLUDED_SOURCES = [
  // Lifehacker has been re-enabled since we improved error handling
];

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing required environment variables');
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey, { 
      auth: { persistSession: false } 
    });

    // Get RSS bot profile
    console.log('Fetching RSS bot profile...');
    const { data: botProfile, error: botError } = await supabaseClient
      .from('profiles')
      .select('id')
      .eq('is_bot', true)
      .eq('full_name', 'RSS Bot')
      .single();

    if (botError || !botProfile) {
      console.error('Error fetching bot profile:', botError);
      throw new Error('Failed to fetch bot profile');
    }

    const botId = botProfile.id;
    console.log('Using Bot ID:', botId);

    // Fetch active RSS sources
    console.log('Fetching RSS sources...');
    const { data: sources, error: sourcesError } = await supabaseClient
      .from('rss_sources')
      .select('*')
      .eq('active', true);

    if (sourcesError) {
      console.error('Error fetching RSS sources:', sourcesError);
      throw sourcesError;
    }

    console.log(`Found ${sources?.length || 0} active RSS sources`);

    const results = [];
    const errors = [];

    for (const source of sources || []) {
      try {
        // Check if the source URL contains any excluded domains
        if (EXCLUDED_SOURCES.some(excluded => source.url.includes(excluded))) {
          console.log(`Skipping excluded source: ${source.name} (${source.url})`);
          continue;
        }

        console.log(`Processing source: ${source.name}`);
        
        // Fetch RSS feed
        const response = await fetch(source.url);
        if (!response.ok) {
          console.error(`Failed to fetch ${source.name}: ${response.status}`);
          errors.push(`Failed to fetch ${source.name}: ${response.status}`);
          continue;
        }

        const xml = await response.text();
        const feed = parseXML(xml);
        
        // Safely access entries with null checks
        const entries = Array.isArray(feed?.rss?.channel?.item) 
          ? feed.rss?.channel?.item 
          : Array.isArray(feed?.feed?.entry) 
            ? feed.feed?.entry 
            : [];
        
        console.log(`Found ${entries.length} entries in ${source.name}`);

        for (const entry of entries) {
          try {
            // Validate required fields
            const title = entry?.title?._text;
            if (!title?.trim()) {
              console.log(`Skipping entry without valid title in ${source.name}`);
              continue;
            }

            // Safely extract content with fallbacks
            const content = entry?.content?._text || 
                          entry?.['content:encoded']?._text || 
                          entry?.description?._text || 
                          '';
            
            if (!content?.trim()) {
              console.log(`Skipping entry without content in ${source.name}`);
              continue;
            }

            const timestamp = new Date().getTime();
            const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${timestamp}`;

            const { data: post, error: postError } = await supabaseClient
              .from('posts')
              .insert({
                title,
                content,
                excerpt: content.substring(0, 200),
                author_id: botId,
                slug,
                meta_description: content.substring(0, 160),
                reading_time_minutes: Math.ceil((content?.split(' ')?.length || 0) / 200) || 5
              })
              .select()
              .single();

            if (postError) {
              console.error(`Error creating post from ${source.name}:`, postError);
              errors.push(`Failed to create post "${title}" from ${source.name}`);
              continue;
            }

            results.push(post);
            console.log(`Created post: ${title}`);
          } catch (entryError) {
            console.error(`Error processing entry from ${source.name}:`, entryError);
            errors.push(`Error processing entry from ${source.name}: ${entryError?.message || 'Unknown error'}`);
            continue;
          }
        }

        // Update last fetch time regardless of individual entry failures
        await supabaseClient
          .from('rss_sources')
          .update({ last_fetch_at: new Date().toISOString() })
          .eq('id', source.id);

      } catch (sourceError) {
        console.error(`Error processing source ${source.name}:`, sourceError);
        errors.push(`Failed to process source ${source.name}: ${sourceError?.message || 'Unknown error'}`);
        continue;
      }
    }

    return new Response(
      JSON.stringify({ 
        message: `Successfully processed ${results.length} posts`,
        posts: results,
        errors: errors.length > 0 ? errors : undefined
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: errors.length > 0 ? 207 : 200 // Use 207 Multi-Status when there are partial failures
      }
    );

  } catch (error) {
    console.error('Error in main function:', error);
    return new Response(
      JSON.stringify({ 
        error: error?.message || 'Unknown error occurred',
        stack: error?.stack
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
