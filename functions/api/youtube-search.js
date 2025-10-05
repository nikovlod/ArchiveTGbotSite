// File: functions/api/youtube-search.js

/**
 * Validates the initData string from Telegram.
 */
async function isInitDataValid(initData, botToken) {
    if (!initData || typeof initData !== 'string') return false;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckString = Array.from(params.keys()).sort().map(key => `${key}=${params.get(key)}`).join('\n');
    try {
        const encoder = new TextEncoder();
        const secretKeyData = encoder.encode('WebAppData');
        const secretKey = await crypto.subtle.importKey('raw', secretKeyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const botTokenKey = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
        const finalKey = await crypto.subtle.importKey('raw', botTokenKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const calculatedHashBuffer = await crypto.subtle.sign('HMAC', finalKey, encoder.encode(dataCheckString));
        const calculatedHashHex = Array.from(new Uint8Array(calculatedHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        return calculatedHashHex === hash;
    } catch (error) {
        console.error("Crypto validation failed:", error);
        return false;
    }
}

/**
 * Main handler for POST requests.
 */
export async function onRequestPost(context) {
    try {
        const { request, env } = context;

        // Access environment variables
        const BOT_TOKEN = env.BOT_TOKEN;
        const YOUTUBE_API_KEY = env.YOUTUBE_API_KEY;
        const YOUTUBE_CHANNEL_IDS = env.YOUTUBE_CHANNEL_IDS;

        if (!BOT_TOKEN || !YOUTUBE_API_KEY || !YOUTUBE_CHANNEL_IDS) {
            return new Response(JSON.stringify({ error: 'Server configuration error: Missing API keys or Channel IDs.' }), { status: 500 });
        }

        const { query, initData } = await request.json();

        // 1. Validate the user data
        const isValid = await isInitDataValid(initData, BOT_TOKEN);
        if (!isValid) {
            return new Response(JSON.stringify({ error: 'Authentication failed.' }), { status: 403 });
        }
        
        if (!query) {
             return new Response(JSON.stringify([]), { status: 200 });
        }

        // 2. Perform parallel searches for each channel
        const channelIds = YOUTUBE_CHANNEL_IDS.split(',').map(id => id.trim());
        const searchPromises = channelIds.map(channelId => {
            const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&channelId=${channelId}&type=video&key=${YOUTUBE_API_KEY}&maxResults=10`;
            return fetch(searchUrl).then(res => res.json());
        });

        const results = await Promise.all(searchPromises);
        
        // 3. Flatten and format the results
        const videos = results.flatMap(result => result.items || [])
                              .map(item => ({
                                  title: item.snippet.title,
                                  url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                                  channel: item.snippet.channelTitle
                              }));

        return new Response(JSON.stringify(videos), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('YouTube Search API Error:', error);
        return new Response(JSON.stringify({ error: 'An internal server error occurred during search.', details: error.message }), { status: 500 });
    }
}
