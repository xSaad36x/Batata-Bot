const fs = require('fs');
const path = require('path');
const config = require("../config")

const WARN_LIMIT = config.WARN_COUNT
const warningsFilePath = path.join(__dirname, '../data/warnings.json');

function loadWarnings() {
    if (!fs.existsSync(warningsFilePath)) {
        fs.writeFileSync(warningsFilePath, JSON.stringify({}), 'utf8');
    }
    const data = fs.readFileSync(warningsFilePath, 'utf8');
    return JSON.parse(data);
}

function generateWarningHistoryMessage(userJid, userWarnData, warnLimit) {
    // FORCE STRIP: Removes the '+' sign and everything else except numbers for text rendering
    const userCleanNode = userJid.split('@')[0].replace(/\D/g, '');
    
    if (!userWarnData || !userWarnData.warningsDetails || userWarnData.warningsDetails.length === 0) {
        return `*『 WARNING HISTORY 』*\n\n` +
               `👤 *User:* @${userCleanNode}\n` +
               `⚠️ *Total Warns:* 0/${warnLimit}\n\n` +
               `✅ *This user has a clean record!*`;
    }

    const totalWarns = userWarnData.warnCount || 0;
    
    let message = `*『 WARNING HISTORY 』*\n\n` +
                  `👤 *User:* @${userCleanNode}\n` +
                  `⚠️ *Total Warns:* ${totalWarns}/${warnLimit}\n\n` +
                  `📜 *Recent Warnings:*\n`;

    const reversedDetails = [...userWarnData.warningsDetails].reverse();
    
    reversedDetails.forEach((warn, index) => {
        // Strip out the admin number text as well to ensure their tags stay blue too
        const adminCleanNode = warn.warnedBy.split('@')[0].replace(/\D/g, '');
        message += `${index + 1}. [${warn.date.split(",")[0]}] by @${adminCleanNode}\n` +
                   `📄 *Reason:* ${warn.reason || 'None'}\n`;
    });

    return message.trim();
}

async function warningsCommand(sock, chatId, mentionedJidList, isMentionedAll) {
    const warnings = loadWarnings();
    if (isMentionedAll) {        
        // 1. Fetch live real-time group details directly from WhatsApp socket cache
        const groupMetadata = await sock.groupMetadata(chatId);
        const liveTotalUsers = groupMetadata.participants.length; // Absolute real total count

        // Get current group data or fallback to an empty object if no warnings exist yet
        const currentGroupData = warnings[chatId] || {};
        const userTotals = {};

        // 2. Loop only through warned users inside this specific group chat
        for (const userJid in currentGroupData) {
            const userRecord = currentGroupData[userJid];
            const currentWarnCount = userRecord.warnCount || 0;
            if (currentWarnCount > 0) {
                userTotals[userJid] = currentWarnCount;
            }
        }
        // 3. Sort warned members descending (highest warnings first)
        const sortedWarnedUsers = Object.entries(userTotals)
            .map(([jid, count]) => ({ jid, count }))
            .sort((a, b) => b.count - a.count);

        const usersWithActiveWarns = sortedWarnedUsers.length;

        // 4. Construct the updated text template using the live total count
        let responseText = `*『 GROUP WARNINGS 』*\n\n` +
                           `👥 *Total Users:* ${liveTotalUsers}\n` + // Shows true current group size
                           `⚠️ *Users with Warns:* ${usersWithActiveWarns}\n\n` +
                           `*Top Warned:*\n`;

        const serverMentions = [];
        
        if (usersWithActiveWarns > 0) {
            sortedWarnedUsers.forEach((user, index) => {
                // Strip '+' and unexpected characters to make the blue highlight tags click-safe
                const cleanUserTextNode = user.jid.split('@')[0].replace(/\D/g, '');
                responseText += `${index + 1}. @${cleanUserTextNode} - ${user.count}/${WARN_LIMIT}\n`;
                serverMentions.push(user.jid);
            });
        } else {
            responseText += `🎉 No users have active warnings recorded in this group!\n`;
        }

        responseText += `\nUse \`.warnings @user\` for details`;

        // 5. Emit payload back downstream to the group chat
        await sock.sendMessage(chatId, { 
            text: responseText.trim(), 
            mentions: serverMentions 
        });
        return;
    }

    if (mentionedJidList.length === 0) {
        await sock.sendMessage(chatId, { text: 'Please mention a user to check warnings.' });
        return;
    }

    const userToCheck = mentionedJidList[0];
    const userWarnData = warnings[chatId]?.[userToCheck] || { warnCount: 0, warningsDetails: [] };

    const mentionsArray = [userToCheck];
    if (userWarnData.warningsDetails) {
        userWarnData.warningsDetails.forEach(w => {
            if (w.warnedBy) {
                const adminJid = w.warnedBy.includes('@') ? w.warnedBy : `${w.warnedBy}@s.whatsapp.net`;
                if (!mentionsArray.includes(adminJid)) {
                    mentionsArray.push(adminJid);
                }
            }
        });
    }
    await sock.sendMessage(chatId, {
        text: generateWarningHistoryMessage(userToCheck, userWarnData, WARN_LIMIT),
        mentions: mentionsArray
    });
}

module.exports = warningsCommand;