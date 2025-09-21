// File: functions/api/get-data.js

// This import statement is the correct way to include a project file.
// Cloudflare's build system will bundle the JSON content with the function.
import jsonData from '../../data.json';

/**
 * Validates the initData string using the Web Crypto API.
 * @param {string} initData The initData string from the Telegram Web App.
 * @param {string} botToken The secret bot token.
 * @returns {Promise<boolean>} True if the data is authentic.
 */
async function isInitDataValid(initData, botToken) {
    if (!initData || typeof initData !== 'string') return false;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    const dataCheckString = Array.from(params.keys())
        .sort()
        .map(key => `${key}=${params.get(key)}`)
        .join('\n');

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
        return false;
    } catch (error) {
        console.error('Failed to check membership:', error);
        return false;
    }
}

/**
 * Main handler for POST requests.
 */
export async function onRequestPost(context) {
    try {
        const { request, env } = context;

        // Access environment variables (set in the Pages dashboard)
        const BOT_TOKEN = env.BOT_TOKEN;
        const PRIVATE_CHANNEL_ID = env.PRIVATE_CHANNEL_ID;

        if (!BOT_TOKEN || !PRIVATE_CHANNEL_ID) {
            console.error("Server configuration error: Bot Token or Channel ID is missing.");
            return new Response(JSON.stringify({ error: 'Server configuration error.' }), { status: 500 });
        }

        const { initData } = await request.json();

        // 1. Validate the data
        const isValid = await isInitDataValid(initData, BOT_TOKEN);
        if (!isValid) {
            return new Response(JSON.stringify({ error: 'Authentication failed: Invalid data.' }), { status: 403 });
        }

        // 2. Extract user ID and check membership
        const user = JSON.parse(new URLSearchParams(initData).get('user'));
        const isMember = await isUserMember(user.id, PRIVATE_CHANNEL_ID, BOT_TOKEN);

        // 3. Return data only if the user is a member
        if (isMember) {
            // jsonData is available directly because of the import statement.
            return new Response(JSON.stringify(jsonData), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: 'Access Denied: You must be a subscriber of the private channel.' }), { status: 403 });
        }

    } catch (error) {
        console.error('Internal Server Error:', error);
        return new Response(JSON.stringify({ error: 'An internal server error occurred.', details: error.message }), { status: 500 });
    }
}
