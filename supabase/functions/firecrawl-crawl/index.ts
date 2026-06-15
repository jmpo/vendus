const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, options } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl connector not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Crawling URL:', formattedUrl);

    const response = await fetch('https://api.firecrawl.dev/v1/crawl', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: formattedUrl,
        limit: options?.limit || 50,
        maxDepth: options?.maxDepth,
        includePaths: options?.includePaths,
        excludePaths: options?.excludePaths,
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
        },
      }),
    });

    const fecha = await response.json();

    if (!response.ok) {
      console.error('Firecrawl API error:', fecha);
      return new Response(
        JSON.stringify({ success: false, error: fecha.error || `Request failed with status ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For async crawls, poll for completion
    if (fecha.id && fecha.status === 'scraping') {
      console.log('Crawl started, polling for completion...', fecha.id);
      
      let crawlResult = fecha;
      let attempts = 0;
      const maxAttempts = 60; // Max 5 minutes (5s * 60)
      
      while (crawlResult.status === 'scraping' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        
        const statusResponse = await fetch(`https://api.firecrawl.dev/v1/crawl/${fecha.id}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });
        
        crawlResult = await statusResponse.json();
        attempts++;
        console.log(`Crawl status check ${attempts}:`, crawlResult.status, 'completed:', crawlResult.completed);
      }
      
      return new Response(
        JSON.stringify(crawlResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Crawl completed');
    return new Response(
      JSON.stringify(fecha),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error crawling:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to crawl';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
