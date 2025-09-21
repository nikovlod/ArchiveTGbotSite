// File: functions/api/get-data.js

/**
 * Validates the initData string using the Web Crypto API (supported by Cloudflare).
 * @param {string} initData The initData string from the Telegram Web App.
 * @param {string} botToken The secret bot token.
 * @returns {Promise<boolean>} True if the data is authentic.
 */
async function isInitDataValid(initData, botToken) {
    if (!initData || typeof initData !== 'string') {
        return false;
    }
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    const sortedKeys = Array.from(params.keys()).sort();
    const dataCheckString = sortedKeys
        .map(key => `${key}=${params.get(key)}`)
        .join('\n');

    try {
        const secretKey = await crypto.subtle.importKey(
            'raw',
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode('WebAppData')),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const encoder = new TextEncoder();
        const signature = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
        
        const finalKey = await crypto.subtle.importKey('raw', signature, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const calculatedHash = await crypto.subtle.sign('HMAC', finalKey, encoder.encode(dataCheckString));

        // Convert the ArrayBuffer to a hex string
        const hexHash = Array.from(new Uint8Array(calculatedHash)).map(b => b.toString(16).padStart(2, '0')).join('');
        
        return hexHash === hash;
    } catch (error) {
        console.error("Crypto validation failed:", error);
        return false;
    }
}

/**
 * Calls the Telegram API to check if a user is in a channel.
 */
async function isUserMember(userId, channelId, botToken) {
    const url = `https://api.telegram.org/bot${botToken}/getChatMember`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: channelId, user_id: userId })
        });
        const data = await response.json();
        if (data.ok) {
            const status = data.result.status;
            return ['creator', 'administrator', 'member'].includes(status);
        }
    } catch (error) {
        console.error('Failed to check membership:', error);
    }
    return false;
}

/**
 * Main handler for POST requests.
 */
export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        
        // --- Access environment variables and the data.json binding ---
        const BOT_TOKEN = env.BOT_TOKEN;
        const PRIVATE_CHANNEL_ID = env.PRIVATE_CHANNEL_ID;
        const jsonDataAsset = env.DATA_JSON; // This is our binding

        if (!BOT_TOKEN || !PRIVATE_CHANNEL_ID) {
            return new Response(JSON.stringify({ error: 'Server configuration error: Bot Token or Channel ID is missing.' }), { status: 500 });
        }
        if (!jsonDataAsset) {
            return new Response(JSON.stringify({ error: 'Server configuration error: The data file binding is not set up.' }), { status: 500 });
        }

        const { initData } = await request.json();
        
        // 1. Validate the data
        const isValid = await isInitDataValid(initData, BOT_TOKEN);
        if (!isValid) {
            return new Response(JSON.stringify({ error: 'Authentication failed: Invalid data.' }), { status: 403 });
        }

        // 2. Extract user ID and check membership
        const params = new URLSearchParams(initData);
        const user = JSON.parse(params.get('user'));
        const isMember = await isUserMember(user.id, PRIVATE_CHANNEL_ID, BOT_TOKEN);

        // 3. Return data only if the user is a member
        if (isMember) {
            // Read the content from the bound asset
            const jsonData = await jsonDataAsset.json();
            return new Response(JSON.stringify(jsonData), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: 'Access Denied: You must be a subscriber of the private channel.' }), { status: 403 });
        }

    } catch (error) {
        // Return the actual error message for easier debugging
        return new Response(JSON.stringify({ error: 'An internal server error occurred.', details: error.message }), { status: 500 });
    }
}
