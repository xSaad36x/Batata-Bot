const { setAntiBadword, getAntiBadword, removeAntiBadword, incrementWarningCount, resetWarningCount } = require('../lib/index');
const fs = require('fs');
const path = require('path');
const warnCommand = require('../commands/warn');
const badWords = global.badWordsSet

// Load antibadword config
function loadAntibadwordConfig(groupId) {
    try {
        const configPath = path.join(__dirname, '../data/userGroupData.json');
        if (!fs.existsSync(configPath)) {
            return {};
        }
        const data = JSON.parse(fs.readFileSync(configPath));
        return data.antibadword?.[groupId] || {};
    } catch (error) {
        console.error('❌ Error loading antibadword config:', error.message);
        return {};
    }
}

async function handleAntiBadwordCommand(sock, chatId, message, match) {
    if (!match) {
        return sock.sendMessage(chatId, {
            text: `*ANTIBADWORD SETUP*\n\n*.antibadword on*\nTurn on antibadword\n\n*.antibadword set <action>*\nSet action: delete/kick/warn\n\n*.antibadword off*\nDisables antibadword in this group`
        }, { quoted: message });
    }

    if (match === 'on') {
        const existingConfig = await getAntiBadword(chatId, 'on');
        if (existingConfig?.enabled) {
            return sock.sendMessage(chatId, { text: '*AntiBadword is already enabled for this group*' });
        }
        await setAntiBadword(chatId, 'on', 'delete');
        return sock.sendMessage(chatId, { text: '*AntiBadword has been enabled. Use .antibadword set <action> to customize action*' }, { quoted: message });
    }

    if (match === 'off') {
        const config = await getAntiBadword(chatId, 'on');
        if (!config?.enabled) {
            return sock.sendMessage(chatId, { text: '*AntiBadword is already disabled for this group*' }, { quoted: message } );
        }
        await removeAntiBadword(chatId);
        return sock.sendMessage(chatId, { text: '*AntiBadword has been disabled for this group*' }, { quoted: message } );
    }

    if (match.startsWith('set')) {
        const action = match.split(' ')[1];
        if (!action || !['delete', 'kick', 'warn'].includes(action)) {
            return sock.sendMessage(chatId, { text: '*Invalid action. Choose: delete, kick, or warn*' }, { quoted: message } );
        }
        await setAntiBadword(chatId, 'on', action);
        return sock.sendMessage(chatId, { text: `*AntiBadword action set to: ${action}*` }, { quoted: message } );
    }

    return sock.sendMessage(chatId, { text: '*Invalid command. Use .antibadword to see usage*' }, { quoted: message } );
}

async function handleBadwordDetection(sock, chatId, message, userMessage, senderId) {
    const config = loadAntibadwordConfig(chatId);
    if (!config.enabled) return;

    // Exit early if global Set is not ready or if the message is empty
    if (!global.badWordsSet || !userMessage) return;

    // Skip if not group
    if (!chatId.endsWith('@g.us')) return;

    // Skip if message is from bot
    if (message.key.fromMe) return;

    // Get antibadword config first
    const antiBadwordConfig = await getAntiBadword(chatId, 'on');
    if (!antiBadwordConfig?.enabled) {
        console.log('Antibadword not enabled for this group');
        return;
    }
    // Convert message to lowercase
    const lowerMessage = userMessage.toLowerCase();

    // 1. Collapse repeated characters (e.g., "fuuuuuck" -> "fuck", "zbbbbi" -> "zbi")
    // This regex looks for any character that repeats 2 or more times and keeps only one.
    const collapsedText = lowerMessage.replace(/(.)\1+/g, '$1');

    // 2. Safely strip punctuation and special characters across all languages (Unicode-safe)
    const cleanMessage = collapsedText
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // 3. Split into words and perform the fast Set lookup
    const messageWords = cleanMessage.split(/\s+/);
    let containsBadWord = false;

    // O(1) ultra-fast lookup loop
    for (const word of messageWords) {
        if (global.badWordsSet.has(word)) {
            containsBadWord = true;
            break; // Stop execution immediately on the first match to save CPU cycles
        }
    }
    if (!containsBadWord) return;

   // console.log('Bad word detected in:', userMessage);

    // Fetch group metadata to verify roles
    const groupMetadata = await sock.groupMetadata(chatId);
    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const bot = groupMetadata.participants.find(p => p.phoneNumber === botId);

    // Exit early if the bot doesn't have admin privileges to delete messages or restrict users
    if (!bot?.admin) {
        // console.log('Bot is not admin, cannot take action');
        return;
    }

    // Check if sender is admin
    // const participant = groupMetadata.participants.find(p => p.id === senderId);
    // if (participant?.admin) {
    //     // console.log('Sender is admin, skipping action');
    //     return;
    // }
    // Delete message immediately
    try {
        await sock.sendMessage(chatId, { 
            delete: message.key
        });
        console.log('Message deleted successfully');
    } catch (err) {
        console.error('Error deleting message:', err);
        return;
    }
    // Take action based on config
    switch (antiBadwordConfig.action) {
        case 'delete':
            await sock.sendMessage(chatId, {
                text: `*@${senderId.split('@')[0]} bad words are not allowed here*`,
                mentions: [senderId]
            });
            break;

        case 'kick':
            try {
                await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                await sock.sendMessage(chatId, {
                    text: `*@${senderId.split('@')[0]} has been kicked for using bad words*`,
                    mentions: [senderId]
                });
            } catch (error) {
                console.error('Error kicking user:', error);
            }
            break;

        case 'warn':
            warnCommand(sock, chatId, botId, [senderId], message, "Bad Word")
    }
}

module.exports = {
    handleAntiBadwordCommand,
    handleBadwordDetection
}; 