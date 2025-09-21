// File: functions/api/get-data.js

// We can import the JSON file directly. Cloudflare will bundle it with the function.
import jsonData from '../../data.json';

/**
 * Validates the initData string from Telegram.
 * @param {string} initData The initData string from the Telegram Web App.
 * @param {string} botToken The secret bot token.
 * @returns {boolean} True if the data is authentic, false otherwise.
 */
function isInitDataValid(initData, botToken) {
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
        // This uses the Web Crypto API, available in Cloudflare Workers/Functions
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        return calculatedHash === hash;
    } catch (error) {
        console.error("Crypto validation failed:", error);
        return false;
    }
}

/**
 * Calls the Telegram API to check if a user is in a channel.
 * @param {string} userId The user's Telegram ID.
 * @param {string} channelId The ID of the private channel.
 * @param {string} botToken The secret bot token.
 * @returns {Promise<boolean>} True if the user is a member.
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
 * The main handler for POST requests to this serverless function.
 * Cloudflare automatically routes requests to /api/get-data to this function.
 */
export async function onRequestPost(context) {
    try {
        const {
            request,
            env
        } = context;
        const { initData } = await request.json();

        // --- Environment variables must be set in your Cloudflare project settings ---
        const BOT_TOKEN = env.BOT_TOKEN;
        const PRIVATE_CHANNEL_ID = env.PRIVATE_CHANNEL_ID;

        if (!BOT_TOKEN || !PRIVATE_CHANNEL_ID) {
            throw new Error("Bot token or Channel ID is not configured on the server.");
        }

        // 1. Validate the data to ensure it's from Telegram
        if (!isInitDataValid(initData, BOT_TOKEN)) {
            return new Response(JSON.stringify({ error: 'Authentication failed: Invalid data.' }), { status: 403, headers: { 'Content-Type': 'application/json' }});
        }

        // 2. Extract user ID and check channel membership
        const params = new URLSearchParams(initData);
        const user = JSON.parse(params.get('user'));
        
        const isMember = await isUserMember(user.id, PRIVATE_CHANNEL_ID, BOT_TOKEN);

        // 3. Return data only if the user is a member
        if (isMember) {
            return new Response(JSON.stringify(jsonData), { status: 200, headers: { 'Content-Type': 'application/json' }});
        } else {
            return new Response(JSON.stringify({ error: 'Access Denied: You must be a subscriber of the private channel.' }), { status: 403, headers: { 'Content-Type': 'application/json' }});
        }

    } catch (error) {
        return new Response(JSON.stringify({ error: 'An internal server error occurred.', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}
