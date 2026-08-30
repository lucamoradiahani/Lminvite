require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

// Built-in HTTP Keep-Alive server for 24/7 cloud hosting (Render / Koyeb / Railway)
const PORT = process.env.PORT || 8080;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("LM Shop Discord Bot is 100% Online 24/7!");
  })
  .listen(PORT, () => {
    console.log(`✓ HTTP Keep-Alive server active on port ${PORT}`);
  });

// Database file
const DB_FILE = path.join(__dirname, "invites.json");

// In-memory cache
let inMemoryDB = null;

// Load DB from local file
function loadDB() {
  if (inMemoryDB) return inMemoryDB;
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = { users: {}, joins: {}, pendingJoins: {}, liveMessage: null, completedTickets: {} };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
      inMemoryDB = initial;
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (!data.users) data.users = {};
    if (!data.joins) data.joins = {};
    if (!data.pendingJoins) data.pendingJoins = {};
    if (!data.completedTickets) data.completedTickets = {};
    if (data.liveMessage === undefined) data.liveMessage = null;
    inMemoryDB = data;
    return data;
  } catch (err) {
    console.error("Error loading database:", err);
    inMemoryDB = { users: {}, joins: {}, pendingJoins: {}, liveMessage: null, completedTickets: {} };
    return inMemoryDB;
  }
}

// Save DB (debounced cloud backup to Discord attachment)
let saveTimeout = null;
function saveDB(data) {
  inMemoryDB = data;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving database file:", err);
  }

  // Auto-backup to Discord Channel Cloud Attachment every 5 seconds
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    backupDBToDiscord(data).catch(() => {});
  }, 5000);
}

// Helper to get or initialize user record
function getUserStats(db, userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      regular: 0,
      bonus: 0,
      left: 0,
      fake: 0,
    };
  }
  const u = db.users[userId];
  const total = Math.max(0, (u.regular || 0) + (u.bonus || 0) - (u.left || 0));
  return { ...u, total };
}

// ── Strict Role & Permission Helpers ──
function isOwnerOrStar(member) {
  if (!member || !member.guild) return false;
  // 1. Server Owner (100% check)
  if (member.id === member.guild.ownerId) return true;

  // 2. Administrator permission
  if (member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  // 3. Exact star role match ONLY (e.g. role named exactly "*" or "⭐" or "owner")
  return member.roles.cache.some((r) => {
    const raw = r.name.trim();
    const clean = raw.toLowerCase();
    return raw === "*" || raw === "⭐" || raw === "★" || clean === "sterretje" || clean === "owner" || clean === "eigenaar";
  });
}

function hasInvitesPermission(member) {
  if (!member || !member.guild) return false;
  // Server Owner or Admin always has access
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  // Allows *Member*, *Customer*, *Booster*, Member, Customer, Booster, etc.
  return member.roles.cache.some((r) => {
    const clean = r.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return (
      clean.includes("member") ||
      clean.includes("lid") ||
      clean.includes("leden") ||
      clean.includes("boost") ||
      clean.includes("customer") ||
      clean.includes("klant") ||
      clean.includes("buyer") ||
      clean.includes("verified") ||
      clean.includes("geverifieerd")
    );
  });
}

// Initialize Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Cache for Guild Invites: guildId -> Collection<code, uses>
const guildInvites = new Map();

// Helper to build leaderboard embed in English
function createLeaderboardEmbed(guild, db) {
  const entries = Object.entries(db.users).map(([userId, stats]) => {
    const total = Math.max(0, (stats.regular || 0) + (stats.bonus || 0) - (stats.left || 0));
    return {
      userId,
      regular: stats.regular || 0,
      bonus: stats.bonus || 0,
      left: stats.left || 0,
      total,
    };
  });

  // Sort descending by total invites
  entries.sort((a, b) => b.total - a.total);

  const top10 = entries.slice(0, 10);

  const botCmdChannel = guild.channels.cache.find(
    (c) => c.isTextBased() && (c.name.includes("bot-command") || c.name.includes("commands") || c.name.includes("bot"))
  );
  const botCmdMention = botCmdChannel ? `<#${botCmdChannel.id}>` : "`#bot-commands`";

  let desc = `🏆 **LM SHOP MONTHLY INVITE LEADERBOARD** 🏆\n\n`;
  desc += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  desc += `🎁 **MONTHLY RESET REWARDS:**\n`;
  desc += `🥇 **#1 Spot:** 🚀 **Discord Nitro** + 🎮 **Minecraft FA** + 🍿 **Netflix Key**\n`;
  desc += `🥈 **#2 & #3 Spot:** 🎮 **Minecraft FA** + 🍿 **Netflix Key**\n`;
  desc += `🥉 **#4 & #5 Spot:** 🍿 **Netflix Key**\n`;
  desc += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (top10.length === 0 || top10.every((e) => e.total === 0)) {
    desc += `*No invites registered yet. Be the first to invite friends and claim the #1 spot! ⚡*\n`;
  } else {
    top10.forEach((entry, idx) => {
      let medal = `**#${idx + 1}**`;
      if (idx === 0) medal = `🥇 **#1**`;
      else if (idx === 1) medal = `🥈 **#2**`;
      else if (idx === 2) medal = `🥉 **#3**`;
      else if (idx === 3) medal = `🏅 **#4**`;
      else if (idx === 4) medal = `🏅 **#5**`;

      desc += `${medal} <@${entry.userId}> — **${entry.total} invites** *(+${entry.regular} verified, -${entry.left} left, +${entry.bonus} bonus)*\n`;
    });
  }

  desc += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  desc += `🌐 **Webshop:** [https://lmshop.netlify.app](https://lmshop.netlify.app)\n`;
  desc += `🤖 ・ **Check your invites at ${botCmdMention}** *(type \`/invites\`)*\n`;
  desc += `🔄 *This leaderboard automatically refreshes live every 60 seconds.*`;

  return new EmbedBuilder()
    .setTitle("👑 LM Shop — Top 10 Invites Leaderboard")
    .setColor("#5865F2")
    .setDescription(desc)
    .setThumbnail(guild.iconURL({ dynamic: true }) || "https://lmshop.netlify.app/favicon.svg")
    .setFooter({ text: "LM Shop • Live Realtime Auto-Update", iconURL: "https://lmshop.netlify.app/favicon.svg" })
    .setTimestamp();
}

// ── Live Leaderboard Auto-Update Function ──
async function updateLiveLeaderboard() {
  const db = loadDB();
  if (!db.liveMessage || !db.liveMessage.channelId || !db.liveMessage.messageId) return;

  try {
    const channel = await client.channels.fetch(db.liveMessage.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(db.liveMessage.messageId).catch(() => null);
    if (!message) return;

    const embed = createLeaderboardEmbed(channel.guild, db);
    await message.edit({ embeds: [embed] });
  } catch (err) {
    console.error("Error updating live leaderboard:", err.message);
  }
}

// ── Helper: Create Ticket Done Embed and Action Row (Let customer choose to close or keep open) ──
function createTicketDoneMessage() {
  const embed = new EmbedBuilder()
    .setTitle("✅ Bestelling Afgerond / Order Completed")
    .setColor("#2ED573")
    .setDescription(
      "Jouw bestelling is succesvol afgerond en geleverd! 📦⚡\n\n" +
      "Wil je dit ticket nu sluiten, of heb je nog een vraag aan onze support?\n\n" +
      "• Klik op **🔒 Sluit Ticket** als alles naar wens is afgehandeld.\n" +
      "• Klik op **💬 Heb nog een vraag** als je nog hulp nodig hebt."
    )
    .setFooter({ text: "LM Shop • Customer Support • https://lmshop.netlify.app" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close_confirm_btn")
      .setLabel("Sluit Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ticket_need_help_btn")
      .setLabel("Heb nog een vraag")
      .setEmoji("💬")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// ── Helper: Create Ticket Review Prompt Message ──
function createTicketReviewMessage() {
  const embed = new EmbedBuilder()
    .setTitle("⭐ Laat een Review achter / Leave a Review")
    .setColor("#00F0FF")
    .setDescription(
      "Ben je tevreden over onze service en snelle levering? ❤️\n\n" +
      "Klik op de knop hieronder om een beoordeling (1-5 sterren) en review achter te laten voor **LM Shop**! " +
      "Jouw review wordt direct gedeeld in ons vouches kanaal."
    )
    .setFooter({ text: "LM Shop • Customer Vouches • https://lmshop.netlify.app" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_open_review_modal_btn")
      .setLabel("Schrijf Review")
      .setEmoji("⭐")
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

// ── Helper: Create Member Verification Message ──
function createMemberVerifyMessage(guild) {
  const embed = new EmbedBuilder()
    .setTitle("👋 Welcome to LM Shop — Verification & Member Role")
    .setColor("#00F0FF")
    .setDescription(
      `Welcome to the official **LM Shop** Discord community!\n\n` +
      `Click the button below to instantly receive the **\`Member\`** role. This gives you full access to all channels, ticket creation, giveaways, and invite rewards! 🎉\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 **Webshop:** [https://lmshop.netlify.app](https://lmshop.netlify.app)\n` +
      `👉 **Click the button below to claim your role:**`
    )
    .setThumbnail(guild?.iconURL({ dynamic: true }) || "https://lmshop.netlify.app/favicon.svg")
    .setFooter({ text: "LM Shop • Member Verification", iconURL: "https://lmshop.netlify.app/favicon.svg" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("claim_member_role")
      .setLabel("Claim Member Role")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

// ── Helper: Find or Create Private Mod / Staff Log Channel ──
async function getModLogsChannel(guild) {
  if (!guild) return null;

  // 1. Search for existing staff / mod log channels
  let channel = guild.channels.cache.find(
    (c) =>
      c.isTextBased() &&
      (c.name.includes("mod-log") ||
        c.name.includes("modlog") ||
        c.name.includes("ticket-log") ||
        c.name.includes("transcript") ||
        c.name.includes("bot-log") ||
        c.name.includes("bot-data") ||
        c.name.includes("backup") ||
        c.name.includes("staff-log") ||
        c.name.includes("admin-log") ||
        c.name.includes("logs") ||
        c.name.includes("staff") ||
        c.name.includes("admin"))
  );

  // 2. If no log channel exists, automatically create a private 🔒┃mod-logs channel for admins/bot
  if (!channel && guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    try {
      channel = await guild.channels.create({
        name: "🔒┃mod-logs",
        type: 0, // GuildText
        topic: "Private Staff & Database Log Channel (LM Shop)",
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: client.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
          },
        ],
      });
      console.log(`✓ Created private log channel #${channel.name} in ${guild.name}`);
    } catch (err) {
      console.warn("Could not create mod-logs channel:", err.message);
    }
  }

  return channel;
}

// ── Cloud Database Backup & Auto-Restore System (Attachment-Based) ──
async function backupDBToDiscord(data) {
  for (const [, guild] of client.guilds.cache) {
    try {
      // Find private mod-logs channel ONLY (never general or public chats)
      const channel = await getModLogsChannel(guild);

      if (channel) {
        const jsonStr = JSON.stringify(data, null, 2);
        const attachment = new AttachmentBuilder(Buffer.from(jsonStr, "utf-8"), { name: "lm_invites_db.json" });

        const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
        const existingBackup = messages?.find(
          (m) => m.author.id === client.user.id && m.content.startsWith("<!-- LM_DB_BACKUP_V3 -->")
        );

        if (existingBackup) {
          await existingBackup.delete().catch(() => null);
        }

        await channel.send({
          content: `<!-- LM_DB_BACKUP_V3 --> 🔒 **LM Shop Automated Database Cloud Backup** *(Last sync: <t:${Math.floor(Date.now() / 1000)}:R>)*`,
          files: [attachment],
        });
      }
    } catch (err) {
      console.warn("Could not send cloud DB backup:", err.message);
    }
  }
}

async function restoreDBFromCloud(guild) {
  const db = loadDB();
  try {
    const channels = guild.channels.cache.filter((c) => c.isTextBased());
    for (const [, channel] of channels) {
      const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
      if (!messages) continue;

      const backupMsg = messages.find(
        (m) =>
          m.author.id === client.user.id &&
          (m.content.startsWith("<!-- LM_DB_BACKUP_V3 -->") ||
            m.content.startsWith("<!-- LM_DB_BACKUP_V2 -->") ||
            m.content.startsWith("<!-- LM_DB_BACKUP_V1 -->"))
      );

      if (backupMsg) {
        let cloudData = null;

        // Try reading attachment file
        if (backupMsg.attachments.size > 0) {
          const file = backupMsg.attachments.first();
          if (file && file.url) {
            const res = await fetch(file.url);
            cloudData = await res.json();
          }
        } else {
          // Fallback to codeblock match
          const match = backupMsg.content.match(/```json\n([\s\S]*?)\n```/);
          if (match && match[1]) {
            cloudData = JSON.parse(match[1]);
          }
        }

        if (cloudData && cloudData.users) {
          // Restore all user records with left counts, bonus, and regular
          for (const [uid, ustats] of Object.entries(cloudData.users)) {
            if (!db.users[uid]) {
              db.users[uid] = {
                regular: ustats.regular || 0,
                bonus: ustats.bonus || 0,
                left: ustats.left || 0,
                fake: ustats.fake || 0,
              };
            } else {
              db.users[uid].bonus = Math.max(db.users[uid].bonus || 0, ustats.bonus || 0);
              db.users[uid].left = Math.max(db.users[uid].left || 0, ustats.left || 0);
              db.users[uid].regular = Math.max(db.users[uid].regular || 0, ustats.regular || 0);
            }
          }

          // Restore joins map
          if (cloudData.joins) {
            db.joins = { ...cloudData.joins, ...db.joins };
          }
          if (cloudData.pendingJoins) {
            db.pendingJoins = { ...cloudData.pendingJoins, ...db.pendingJoins };
          }
          if (cloudData.liveMessage && !db.liveMessage) {
            db.liveMessage = cloudData.liveMessage;
          }
          if (cloudData.completedTickets) {
            db.completedTickets = { ...cloudData.completedTickets, ...db.completedTickets };
          }

          saveDB(db);
          console.log(`✓ Successfully restored users, left counts (${Object.values(db.users).reduce((a, b) => a + (b.left || 0), 0)} leaves), and joins map from Cloud Backup!`);
          return true;
        }
      }
    }
  } catch (err) {
    console.warn("Cloud restore note:", err.message);
  }
  return false;
}

// ── Helper: Format Ticket HTML Transcript & Send to DM & Staff Logs ──
async function generateAndSendTranscript(channel, closerUser = null, targetUser = null) {
  if (!channel || !channel.isTextBased()) return null;

  try {
    // 1. Fetch channel messages (up to 100 in reverse chronological)
    const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!fetched) return null;

    const messages = Array.from(fetched.values()).reverse();

    // 2. Determine ticket opener / customer
    let ticketUser = targetUser;
    if (!ticketUser) {
      // Check channel topic for user ID
      const topicMatch = channel.topic?.match(/(\d{17,20})/);
      if (topicMatch) {
        ticketUser = await channel.guild.members.fetch(topicMatch[1]).catch(() => null)?.then((m) => m?.user);
      }
    }
    if (!ticketUser) {
      // Check permission overwrites for non-bot member
      for (const [id, overwrite] of channel.permissionOverwrites.cache) {
        if (overwrite.type === 1 /* Member */ && id !== client.user.id) {
          const m = await channel.guild.members.fetch(id).catch(() => null);
          if (m && !m.user.bot) {
            ticketUser = m.user;
            break;
          }
        }
      }
    }
    if (!ticketUser && closerUser && !closerUser.bot) {
      ticketUser = closerUser;
    }

    // 3. Generate Clean Modern HTML Transcript
    let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ticket Transcript — #${channel.name}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f131f; color: #dcddde; margin: 0; padding: 24px; }
    .header { background: #181d2f; border: 1px solid #2a3454; border-radius: 12px; padding: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { margin: 0 0 6px 0; font-size: 22px; color: #00f0ff; }
    .header p { margin: 0; font-size: 14px; color: #8f9bb3; }
    .message { display: flex; margin-bottom: 16px; padding: 12px 16px; background: #141929; border-radius: 8px; border-left: 4px solid #00f0ff; }
    .avatar { width: 42px; height: 42px; border-radius: 50%; margin-right: 14px; background: #2a3454; }
    .msg-body { flex: 1; }
    .msg-header { display: flex; align-items: center; margin-bottom: 4px; gap: 8px; }
    .author { font-weight: bold; color: #ffffff; font-size: 15px; }
    .bot-tag { background: #5865f2; color: #fff; font-size: 10px; font-weight: bold; padding: 2px 5px; border-radius: 4px; }
    .time { font-size: 12px; color: #72767d; }
    .content { font-size: 14px; line-height: 1.5; color: #dcddde; word-break: break-word; white-space: pre-wrap; }
    .embed { background: #1e2538; border-left: 4px solid #5865f2; border-radius: 6px; padding: 12px; margin-top: 8px; }
    .embed-title { font-weight: bold; color: #fff; margin-bottom: 4px; }
    .embed-desc { font-size: 13px; color: #b9bbbe; }
    .footer { text-align: center; margin-top: 32px; font-size: 13px; color: #72767d; }
    a { color: #00f0ff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>📁 LM Shop — Ticket Transcript</h1>
      <p>Ticket: <strong>#${channel.name}</strong> • Server: <strong>${channel.guild.name}</strong> • Total Messages: <strong>${messages.length}</strong></p>
    </div>
    <div style="text-align: right;">
      <p>Customer: <strong>${ticketUser ? ticketUser.tag : "Unknown"}</strong></p>
      <p>Closed on: <strong>${new Date().toLocaleString()}</strong></p>
    </div>
  </div>
  <div class="messages">`;

    for (const msg of messages) {
      const avatarUrl = msg.author.displayAvatarURL({ dynamic: true, extension: "png" });
      const timeStr = msg.createdAt.toLocaleString();
      const botBadge = msg.author.bot ? `<span class="bot-tag">BOT</span>` : "";

      let embedsHtml = "";
      if (msg.embeds.length > 0) {
        for (const emb of msg.embeds) {
          embedsHtml += `<div class="embed">
            ${emb.title ? `<div class="embed-title">${emb.title}</div>` : ""}
            ${emb.description ? `<div class="embed-desc">${emb.description.replace(/\n/g, "<br>")}</div>` : ""}
          </div>`;
        }
      }

      let attachHtml = "";
      if (msg.attachments.size > 0) {
        attachHtml = `<div style="margin-top:6px;">` + Array.from(msg.attachments.values()).map(a => `<a href="${a.url}" target="_blank">📎 ${a.name}</a>`).join("<br>") + `</div>`;
      }

      htmlContent += `
    <div class="message">
      <img class="avatar" src="${avatarUrl}" alt="${msg.author.username}" />
      <div class="msg-body">
        <div class="msg-header">
          <span class="author">${msg.author.username}</span>
          ${botBadge}
          <span class="time">${timeStr}</span>
        </div>
        <div class="content">${msg.content ? msg.content : ""}</div>
        ${embedsHtml}
        ${attachHtml}
      </div>
    </div>`;
    }

    htmlContent += `
  </div>
  <div class="footer">
    LM Shop Official Transcript • <a href="https://lmshop.netlify.app" target="_blank">https://lmshop.netlify.app</a>
  </div>
</body>
</html>`;

    const fileName = `transcript-${channel.name}.html`;
    const attachment = new AttachmentBuilder(Buffer.from(htmlContent, "utf-8"), { name: fileName });

    // 4. Send Transcript to the Customer via DM
    if (ticketUser) {
      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle(`📁 Ticket Transcript — #${channel.name}`)
          .setColor("#00F0FF")
          .setDescription(
            `Hello **${ticketUser.username}**,\n\n` +
            `Your ticket **\`#${channel.name}\`** in **${channel.guild.name}** has been closed.\n\n` +
            `Attached is your complete, official chat transcript for your records! 📄\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🌐 **Webshop:** [https://lmshop.netlify.app](https://lmshop.netlify.app)\n` +
            `⭐ Thank you for choosing **LM Shop**! We hope to see you again soon.`
          )
          .setFooter({ text: "LM Shop • Customer Support Transcript", iconURL: "https://lmshop.netlify.app/favicon.svg" })
          .setTimestamp();

        await ticketUser.send({ embeds: [dmEmbed], files: [attachment] });
        console.log(`✓ Transcript successfully sent via DM to ${ticketUser.tag}`);
      } catch (dmErr) {
        console.warn(`Could not DM transcript to ${ticketUser.tag} (DMs might be closed):`, dmErr.message);
      }
    }

    // 5. Send Transcript to Staff Mod-Logs Channel
    const modChannel = await getModLogsChannel(channel.guild);
    if (modChannel) {
      try {
        const logEmbed = new EmbedBuilder()
          .setTitle(`📁 Ticket Closed — #${channel.name}`)
          .setColor("#5865F2")
          .setDescription(
            `• **Ticket:** \`#${channel.name}\`\n` +
            `• **Customer:** ${ticketUser ? `<@${ticketUser.id}> (${ticketUser.tag})` : "*Unknown*"}\n` +
            `• **Closed By:** ${closerUser ? `<@${closerUser.id}> (${closerUser.tag})` : "*Automated / System*"}\n` +
            `• **Total Messages:** \`${messages.length}\`\n` +
            `• **DM Status:** ${ticketUser ? "✅ Sent to customer" : "⚠️ Customer not found"}`
          )
          .setFooter({ text: "LM Shop • Mod Logs", iconURL: "https://lmshop.netlify.app/favicon.svg" })
          .setTimestamp();

        await modChannel.send({ embeds: [logEmbed], files: [attachment] });
        console.log(`✓ Transcript logged in #${modChannel.name}`);
      } catch (logErr) {
        console.warn("Could not log transcript to mod-logs:", logErr.message);
      }
    }

    return true;
  } catch (err) {
    console.error("Error generating ticket transcript:", err);
    return null;
  }
}

// ── 24-Hour Auto-Close Checker (Runs every 60 seconds) ──
async function checkCompletedTickets() {
  const db = loadDB();
  if (!db.completedTickets) return;

  const now = Date.now();
  let changed = false;

  for (const [channelId, info] of Object.entries(db.completedTickets)) {
    if (now >= info.autoCloseAt) {
      try {
        const guild = await client.guilds.fetch(info.guildId).catch(() => null);
        if (!guild) {
          delete db.completedTickets[channelId];
          changed = true;
          continue;
        }

        const channel = await guild.channels.fetch(channelId).catch(() => null);

        if (channel) {
          await channel.send("⏳ **24 uur verstreken na afronding.** Het ticket wordt nu automatisch gesloten en het transcript is verzonden.").catch(() => null);
          await generateAndSendTranscript(channel, null, null);
          setTimeout(() => {
            channel.delete("Ticket auto-closed after 24h completion").catch(() => null);
          }, 3000);
        }

        delete db.completedTickets[channelId];
        changed = true;
      } catch (err) {
        console.error(`Error auto-closing ticket ${channelId}:`, err);
        delete db.completedTickets[channelId];
        changed = true;
      }
    }
  }

  if (changed) saveDB(db);
}

// ── Bot Ready & Slash Command Registration ──
client.once("ready", async () => {
  console.log(`✓ Bot is logged in as ${client.user.tag}!`);
  client.user.setActivity("lmshop.netlify.app 🛒 | /leaderboard", { type: 3 });

  const db = loadDB();

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      // 1. Fetch current members
      await guild.members.fetch().catch(() => null);

      // 2. Restore full state (including all left counts and joins mapping) from cloud backup
      await restoreDBFromCloud(guild);

      // 3. Check for offline leaves while bot was restarting
      if (db.joins) {
        for (const [memberId, inviterId] of Object.entries(db.joins)) {
          if (!guild.members.cache.has(memberId)) {
            // User left while bot was offline
            if (!db.users[inviterId]) {
              db.users[inviterId] = { regular: 0, bonus: 0, left: 1, fake: 0 };
            } else {
              db.users[inviterId].left = (db.users[inviterId].left || 0) + 1;
            }
            delete db.joins[memberId];
            console.log(`[Offline Leave Detected] Member ${memberId} left while offline. Counted for inviter ${inviterId}`);
          }
        }
      }

      // 4. Cache & synchronize active invite codes with Discord API
      const firstInvites = await guild.invites.fetch();
      const codeUses = new Map();
      const inviterCounts = {};

      firstInvites.each((inv) => {
        codeUses.set(inv.code, inv.uses);
        if (inv.inviter && !inv.inviter.bot && inv.uses > 0) {
          inviterCounts[inv.inviter.id] = (inviterCounts[inv.inviter.id] || 0) + inv.uses;
        }
      });
      guildInvites.set(guildId, codeUses);

      for (const [inviterId, uses] of Object.entries(inviterCounts)) {
        if (!db.users[inviterId]) {
          db.users[inviterId] = { regular: uses, bonus: 0, left: 0, fake: 0 };
        } else {
          db.users[inviterId].regular = Math.max(db.users[inviterId].regular || 0, uses);
        }
      }
      saveDB(db);

      console.log(`✓ Discord Invites & Leaves Synced for: ${guild.name} (${firstInvites.size} active invite links)`);

      // 5. Clean any old backups accidentally in public channels & post fresh into mod-logs
      for (const [, ch] of guild.channels.cache.filter((c) => c.isTextBased())) {
        if (
          !ch.name.includes("mod-log") &&
          !ch.name.includes("modlog") &&
          !ch.name.includes("bot-data") &&
          !ch.name.includes("backup") &&
          !ch.name.includes("staff-log") &&
          !ch.name.includes("admin-log")
        ) {
          try {
            const msgs = await ch.messages.fetch({ limit: 15 }).catch(() => null);
            const stray = msgs?.filter(
              (m) => m.author.id === client.user.id && m.content.startsWith("<!-- LM_DB_BACKUP_")
            );
            if (stray && stray.size > 0) {
              for (const [, sm] of stray) {
                await sm.delete().catch(() => null);
                console.log(`✓ Deleted stray backup message from public channel #${ch.name}`);
              }
            }
          } catch {
            // ignore
          }
        }
      }
      await backupDBToDiscord(db);

      // 6. Auto-reconnect live leaderboard
      if (db.liveMessage && db.liveMessage.channelId && db.liveMessage.messageId) {
        updateLiveLeaderboard();
      } else {
        for (const [, ch] of guild.channels.cache.filter((c) => c.isTextBased())) {
          try {
            const msgs = await ch.messages.fetch({ limit: 10 }).catch(() => null);
            const found = msgs?.find(
              (m) => m.author.id === client.user.id && m.embeds.some((e) => e.title?.includes("Leaderboard"))
            );
            if (found) {
              db.liveMessage = {
                guildId: guild.id,
                channelId: ch.id,
                messageId: found.id,
              };
              saveDB(db);
              console.log(`✓ Re-connected to existing Live Leaderboard in #${ch.name}!`);
              updateLiveLeaderboard();
              break;
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      console.warn(`Could not load invites for guild ${guild.name}:`, err.message);
    }
  }

  // Register Slash Commands
  const commands = [
    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Sluit dit ticket, genereer HTML transcript en stuur naar klant DM & mod-logs (Staff only)"),
    new SlashCommandBuilder()
      .setName("done")
      .setDescription("Markeer bestelling als klaar en laat klant kiezen om te sluiten of open te houden (Staff only)"),
    new SlashCommandBuilder()
      .setName("review")
      .setDescription("Stuur een review prompt in dit ticket zodat de klant een review kan achterlaten"),
    new SlashCommandBuilder()
      .setName("member")
      .setDescription("Maak een verificatie-rol bericht aan waarmee leden de Member rol claimen (Owner/Admin only)"),
    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("Bekijk het Top 10 Maandelijkse Invite Leaderboard en prijzen"),
    new SlashCommandBuilder()
      .setName("setleaderboard")
      .setDescription("Plaats een live automatisch vernieuwend leaderboard in dit kanaal (Owner/Admin only)"),
    new SlashCommandBuilder()
      .setName("invites")
      .setDescription("Bekijk jouw eigen invite statistieken")
      .addUserOption((option) =>
        option.setName("user").setDescription("De gebruiker waarvan je de invites wilt zien").setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("addinvites")
      .setDescription("Voeg bonus invites toe aan een lid (Owner/Admin only)")
      .addUserOption((option) => option.setName("user").setDescription("Het lid").setRequired(true))
      .addIntegerOption((option) => option.setName("amount").setDescription("Aantal bonus invites").setRequired(true)),
    new SlashCommandBuilder()
      .setName("resetinvites")
      .setDescription("Reset alle invite statistieken voor een nieuwe ronde (Owner/Admin only)"),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✓ Slash commands successfully registered (including /member and /done)!");
  } catch (err) {
    console.error("Error registering slash commands:", err);
  }

  // Start 60-second live auto-updater & completed ticket check
  setInterval(() => {
    updateLiveLeaderboard();
    checkCompletedTickets();
  }, 60 * 1000);

  console.log("✓ Live Leaderboard & Ticket Auto-Close checker active (every 60s)!");
});

// ── Member Join Tracker ──
client.on("guildMemberAdd", async (member) => {
  const cachedInvites = guildInvites.get(member.guild.id);
  const db = loadDB();

  try {
    const newInvites = await member.guild.invites.fetch();
    let usedInvite = null;

    if (cachedInvites) {
      usedInvite = newInvites.find((inv) => {
        const prevUses = cachedInvites.get(inv.code) || 0;
        return inv.uses > prevUses;
      });

      const codeUses = new Map();
      newInvites.each((inv) => codeUses.set(inv.code, inv.uses));
      guildInvites.set(member.guild.id, codeUses);
    }

    if (usedInvite && usedInvite.inviter) {
      const inviterId = usedInvite.inviter.id;

      if (inviterId === member.id) return;

      if (member.pending) {
        if (!db.pendingJoins) db.pendingJoins = {};
        db.pendingJoins[member.id] = inviterId;
        saveDB(db);
        console.log(`[⏳] ${member.user.tag} invited by ${usedInvite.inviter.tag} (Pending screening).`);
      } else {
        if (!db.users[inviterId]) {
          db.users[inviterId] = { regular: 0, bonus: 0, left: 0, fake: 0 };
        }
        db.users[inviterId].regular = (db.users[inviterId].regular || 0) + 1;
        db.joins[member.id] = inviterId;
        saveDB(db);

        const stats = getUserStats(db, inviterId);
        console.log(`[+] ${member.user.tag} joined via ${usedInvite.inviter.tag} (Total: ${stats.total})`);
        updateLiveLeaderboard();
      }
    }
  } catch (err) {
    console.error("Error in join tracking:", err);
  }
});

// ── Member Update Tracker (Verification / Screening Completed) ──
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const becameVerified = oldMember.pending && !newMember.pending;

  if (becameVerified) {
    const db = loadDB();
    const inviterId = db.pendingJoins ? db.pendingJoins[newMember.id] : null;

    if (inviterId && !db.joins[newMember.id]) {
      if (!db.users[inviterId]) {
        db.users[inviterId] = { regular: 0, bonus: 0, left: 0, fake: 0 };
      }

      db.users[inviterId].regular = (db.users[inviterId].regular || 0) + 1;
      db.joins[newMember.id] = inviterId;
      delete db.pendingJoins[newMember.id];
      saveDB(db);

      const stats = getUserStats(db, inviterId);
      console.log(`[✓] ${newMember.user.tag} passed screening! Counted for ${inviterId} (Total: ${stats.total})`);
      updateLiveLeaderboard();
    }
  }
});

// ── Member Leave Tracker ──
client.on("guildMemberRemove", async (member) => {
  const db = loadDB();
  const inviterId = db.joins ? db.joins[member.id] : null;

  if (inviterId) {
    if (!db.users[inviterId]) {
      db.users[inviterId] = { regular: 0, bonus: 0, left: 1, fake: 0 };
    } else {
      db.users[inviterId].left = (db.users[inviterId].left || 0) + 1;
    }
    delete db.joins[member.id];
    saveDB(db);

    const stats = getUserStats(db, inviterId);
    console.log(`[-] ${member.user.tag} left server. Inviter ${inviterId} now has ${stats.left} lefts, ${stats.total} total.`);
    updateLiveLeaderboard();
  } else if (db.pendingJoins && db.pendingJoins[member.id]) {
    delete db.pendingJoins[member.id];
    saveDB(db);
  }
});

// ── Slash Commands & Component Interactions ──
client.on("interactionCreate", async (interaction) => {
  const db = loadDB();

  // 1. Modal Submissions (Review submitted)
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "ticket_review_modal") {
      let ratingInput = interaction.fields.getTextInputValue("review_rating")?.trim() || "5";
      let rating = parseInt(ratingInput, 10);
      if (isNaN(rating) || rating < 1) rating = 1;
      if (rating > 5) rating = 5;

      const stars = "⭐".repeat(rating);
      const feedback = interaction.fields.getTextInputValue("review_feedback")?.trim() || "Great service, fast delivery and friendly support! ⚡";

      // Find Vouches Channel
      const vouchChannel = interaction.guild.channels.cache.find(
        (c) =>
          c.isTextBased() &&
          (c.name.includes("vouch") ||
            c.name.includes("review") ||
            c.name.includes("vouches") ||
            c.name.includes("✅┃vouches"))
      );

      const vouchEmbed = new EmbedBuilder()
        .setTitle("⭐ New Customer Review!")
        .setColor("#00F0FF")
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setDescription(
          `**Customer:** <@${interaction.user.id}> (${interaction.user.username})\n` +
          `**Rating:** ${stars} **(${rating}/5)**\n\n` +
          `💬 **Review:**\n> *"${feedback}"*\n\n` +
          `📦 **Source:** Ticket \`#${interaction.channel.name}\``
        )
        .setFooter({ text: "LM Shop • Verified Customer Review • https://lmshop.netlify.app" })
        .setTimestamp();

      if (vouchChannel) {
        await vouchChannel.send({ embeds: [vouchEmbed] }).catch(() => null);
      }

      // Remove from pending 24h auto-close
      if (db.completedTickets && db.completedTickets[interaction.channelId]) {
        delete db.completedTickets[interaction.channelId];
        saveDB(db);
      }

      await interaction.reply({
        content: `✅ **Thank you for your review!** Your feedback has been published to ${vouchChannel ? `<#${vouchChannel.id}>` : "the vouches channel"}.\n\n📄 *A full chat transcript is being sent to your DM...*\n🔒 *This ticket will automatically close in 5 seconds...*`,
      });

      // Generate and send transcript to customer DM and staff mod-logs
      await generateAndSendTranscript(interaction.channel, interaction.user, interaction.user);

      setTimeout(() => {
        interaction.channel.delete("Customer reviewed and closed ticket").catch(() => null);
      }, 5000);

      return;
    }
  }

  // 2. Button Clicks (Claim Member Role, Close Ticket, or Still Need Help)
  if (interaction.isButton()) {
    // 🌟 Claim Member Role Button
    if (interaction.customId === "claim_member_role") {
      try {
        const guild = interaction.guild;
        if (!guild) {
          return interaction.reply({ content: "❌ Error: Guild not found.", ephemeral: true });
        }

        // Find role named Member, *Member*, Lid, *Lid*, etc.
        const memberRole =
          guild.roles.cache.find((r) => {
            const clean = r.name.toLowerCase().replace(/[^a-z0-9]/g, "");
            return clean === "member" || clean === "members" || clean === "lid" || clean === "leden";
          }) || guild.roles.cache.find((r) => r.name.toLowerCase().includes("member"));

        if (!memberRole) {
          return interaction.reply({
            content: "⚠️ **Role Not Found:** Could not find a role named `Member` in this server. Please make sure a role called `Member` exists and is placed below the Bot role!",
            ephemeral: true,
          });
        }

        if (interaction.member.roles.cache.has(memberRole.id)) {
          return interaction.reply({
            content: `ℹ️ You already have the **${memberRole.name}** role!`,
            ephemeral: true,
          });
        }

        await interaction.member.roles.add(memberRole);
        return interaction.reply({
          content: `✅ **Success!** You have received the **${memberRole.name}** role. Welcome to **LM Shop**! 🎉`,
          ephemeral: true,
        });
      } catch (err) {
        console.error("Error assigning member role:", err);
        return interaction.reply({
          content: `⚠️ Could not assign role. Please ensure the Bot role is placed **above** the Member role in Server Settings > Roles!`,
          ephemeral: true,
        });
      }
    }

    // Close ticket button without review (from /done prompt)
    if (interaction.customId === "ticket_close_confirm_btn") {
      if (db.completedTickets && db.completedTickets[interaction.channelId]) {
        delete db.completedTickets[interaction.channelId];
        saveDB(db);
      }

      await interaction.reply({
        content: "🔒 **Ticket wordt gesloten...** We genereren het chat transcript en sturen dit direct naar jouw DM en het staff archief!",
      });

      await generateAndSendTranscript(interaction.channel, interaction.user, interaction.user);

      setTimeout(() => {
        interaction.channel.delete("Ticket closed by user/staff without review").catch(() => null);
      }, 4000);
      return;
    }

    // Open review modal (from /review prompt)
    if (interaction.customId === "ticket_open_review_modal_btn" || interaction.customId === "ticket_close_btn") {
      const modal = new ModalBuilder()
        .setCustomId("ticket_review_modal")
        .setTitle("Laat een Review achter");

      const ratingInput = new TextInputBuilder()
        .setCustomId("review_rating")
        .setLabel("Beoordeling (1 t/m 5 Sterren)")
        .setPlaceholder("Vul 1, 2, 3, 4 of 5 in")
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(1)
        .setRequired(true)
        .setValue("5");

      const feedbackInput = new TextInputBuilder()
        .setCustomId("review_feedback")
        .setLabel("Jouw Review / Ervaring")
        .setPlaceholder("Schrijf hier je ervaring (bijv. Snelle levering en vriendelijke service!)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000);

      const row1 = new ActionRowBuilder().addComponents(ratingInput);
      const row2 = new ActionRowBuilder().addComponents(feedbackInput);
      modal.addComponents(row1, row2);

      return interaction.showModal(modal);
    }

    if (interaction.customId === "ticket_need_help_btn") {
      // Cancel 24h auto-close
      if (db.completedTickets && db.completedTickets[interaction.channelId]) {
        delete db.completedTickets[interaction.channelId];
        saveDB(db);
      }

      await interaction.reply({
        content: "👋 **Ticket status bijgewerkt!** Onze staff heeft een seintje gekregen dat je nog hulp nodig hebt.",
        ephemeral: true,
      });

      return interaction.channel.send({
        content: `👋 <@${interaction.user.id}> geeft aan nog een vraag te hebben of hulp nodig te hebben. Onze support helpt je zometeen verder!`,
      });
    }
  }

  // 3. Slash Commands
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const member = interaction.member;

  // /close (Owner & Admins / Staff only)
  if (commandName === "close") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: "❌ Dit commando is alleen beschikbaar voor de **Server Eigenaar** en **Staff**!",
        ephemeral: true,
      });
    }

    await interaction.reply("📁 **Sluiten van ticket...** Chat transcript wordt gegenereerd en verzonden naar de DM van de klant en staff logs!");
    await generateAndSendTranscript(interaction.channel, interaction.user, null);

    setTimeout(() => {
      interaction.channel.delete("Ticket closed by staff with transcript").catch(() => null);
    }, 4000);
    return;
  }

  // /review (Send review prompt in ticket)
  if (commandName === "review") {
    const msgData = createTicketReviewMessage();
    return interaction.reply(msgData);
  }

  // /member (Owner & Admins only)
  if (commandName === "member") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: "❌ Dit commando is alleen beschikbaar voor de **Server Eigenaar** en **Admins**!",
        ephemeral: true,
      });
    }

    const msgData = createMemberVerifyMessage(interaction.guild);
    await interaction.channel.send(msgData);

    return interaction.reply({
      content: "✓ **Verificatiebericht aangemaakt!** Leden kunnen nu op de knop klikken om de Member rol te claimen.",
      ephemeral: true,
    });
  }

  // /done (Owner & Admins only)
  if (commandName === "done") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: "❌ Dit commando is alleen beschikbaar voor de **Server Eigenaar** en **Admins**!",
        ephemeral: true,
      });
    }

    // Save ticket auto-close (24 hours)
    if (!db.completedTickets) db.completedTickets = {};
    db.completedTickets[interaction.channelId] = {
      guildId: interaction.guild.id,
      channelId: interaction.channelId,
      completedAt: Date.now(),
      autoCloseAt: Date.now() + 24 * 60 * 60 * 1000,
      completedBy: interaction.user.id,
    };
    saveDB(db);

    const msgData = createTicketDoneMessage();
    return interaction.reply(msgData);
  }

  // /leaderboard (Owner & * only)
  if (commandName === "leaderboard") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: "❌ This command is restricted to the **Server Owner** and **Admins**!",
        ephemeral: true,
      });
    }
    const embed = createLeaderboardEmbed(interaction.guild, db);
    return interaction.reply({ embeds: [embed] });
  }

  // /setleaderboard (Owner & * only)
  if (commandName === "setleaderboard") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: "❌ This command is restricted to the **Server Owner** and **Admins**!",
        ephemeral: true,
      });
    }

    const embed = createLeaderboardEmbed(interaction.guild, db);
    const sentMsg = await interaction.channel.send({ embeds: [embed] });

    db.liveMessage = {
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      messageId: sentMsg.id,
    };
    saveDB(db);

    return interaction.reply({
      content: `✓ **Live Leaderboard successfully set up in <#${interaction.channel.id}>!**\nThis message will automatically refresh live **every 60 seconds** and on every join/leave.`,
      ephemeral: true,
    });
  }

  // /invites (Members, Boosters, Customers)
  if (commandName === "invites") {
    if (!hasInvitesPermission(member)) {
      return interaction.reply({
        content: "❌ This command is only available for **Members**, **Boosters**, and **Customers**!",
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser("user") || interaction.user;
    const stats = getUserStats(db, targetUser.id);

    const embed = new EmbedBuilder()
      .setTitle(`📨 Invites of ${targetUser.username}`)
      .setColor("#00F0FF")
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .setDescription(
        `**${targetUser.username}** has a total of **${stats.total} valid invites**! 🚀\n\n` +
          `📊 **Detailed Statistics:**\n` +
          `• 🟢 **Verified Members:** \`${stats.regular || 0}\`\n` +
          `• 🔴 **Leaves:** \`${stats.left || 0}\`\n` +
          `• 🎁 **Bonus Invites:** \`${stats.bonus || 0}\`\n` +
          `• ✨ **Total Score:** \`${stats.total}\`\n\n` +
          `💡 *Invite more friends to climb into the Top 5 for free Netflix, Minecraft & Nitro!*`
      )
      .setFooter({ text: "LM Shop • https://lmshop.netlify.app" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // /addinvites (Owner & * only)
  if (commandName === "addinvites") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: "❌ This command is restricted to the **Server Owner** and **Admins**!",
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount") || interaction.options.getInteger("aantal") || 0;

    if (!db.users[targetUser.id]) {
      db.users[targetUser.id] = { regular: 0, bonus: 0, left: 0, fake: 0 };
    }
    db.users[targetUser.id].bonus = (db.users[targetUser.id].bonus || 0) + amount;
    saveDB(db);

    const stats = getUserStats(db, targetUser.id);
    updateLiveLeaderboard();

    return interaction.reply({
      content: `✓ **${amount} bonus invites** added to <@${targetUser.id}>. New total: **${stats.total} invites**!`,
    });
  }

  // /resetinvites (Owner & * only)
  if (commandName === "resetinvites") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: "❌ This command is restricted to the **Server Owner** and **Admins**!",
        ephemeral: true,
      });
    }

    db.users = {};
    db.joins = {};
    db.pendingJoins = {};
    saveDB(db);
    updateLiveLeaderboard();

    return interaction.reply({
      content: "🚨 **All invites have been reset for the new round!** Everyone starts back at 0.",
    });
  }
});

// ── Prefix Commands (!member, !done, !leaderboard, !invites, !setleaderboard, !addinvites, !resetinvites) ──
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.toLowerCase().trim();
  const db = loadDB();
  const member = message.member;

  // !member (Owner / Admin only)
  if (content === "!member" || content === "!verify" || content === "!verification") {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ This command is restricted to the **Server Owner** and **Admins**!");
    }

    const msgData = createMemberVerifyMessage(message.guild);
    await message.channel.send(msgData);
    try {
      await message.delete();
    } catch {
      // ignore if lacking manage messages permission
    }
    return;
  }

  // !done (Owner / Admin only)
  if (content === "!done") {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ This command is restricted to the **Server Owner** and **Admins**!");
    }

    if (!db.completedTickets) db.completedTickets = {};
    db.completedTickets[message.channel.id] = {
      guildId: message.guild.id,
      channelId: message.channel.id,
      completedAt: Date.now(),
      autoCloseAt: Date.now() + 24 * 60 * 60 * 1000,
      completedBy: message.author.id,
    };
    saveDB(db);

    const msgData = createTicketDoneMessage();
    return message.channel.send(msgData);
  }

  // !review / !vouch
  if (content === "!review" || content === "!vouch") {
    const msgData = createTicketReviewMessage();
    return message.channel.send(msgData);
  }

  // !close (Owner / Staff only)
  if (content === "!close") {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ This command is restricted to the **Server Owner** and **Staff**!");
    }

    await message.channel.send("📁 **Closing ticket...** Generating chat transcript and sending directly to customer DM & mod logs!");
    await generateAndSendTranscript(message.channel, message.author, null);

    setTimeout(() => {
      message.channel.delete("Ticket closed via !close").catch(() => null);
    }, 4000);
    return;
  }

  if (content === "!setleaderboard") {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ This command is restricted to the **Server Owner** and **Admins**!");
    }

    const embed = createLeaderboardEmbed(message.guild, db);
    const sentMsg = await message.channel.send({ embeds: [embed] });

    db.liveMessage = {
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: sentMsg.id,
    };
    saveDB(db);

    return message.reply("✓ **Live Leaderboard set up!** Automatically refreshing every 60 seconds.");
  }

  if (content === "!leaderboard" || content === "!top") {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ This command is restricted to the **Server Owner** and **Admins**!");
    }
    const embed = createLeaderboardEmbed(message.guild, db);
    return message.reply({ embeds: [embed] });
  }

  if (content.startsWith("!invites") || content.startsWith("!invite")) {
    if (!hasInvitesPermission(member)) {
      return message.reply("❌ This command is only available for **Members**, **Boosters**, and **Customers**!");
    }

    const targetUser = message.mentions.users.first() || message.author;
    const stats = getUserStats(db, targetUser.id);

    const embed = new EmbedBuilder()
      .setTitle(`📨 Invites of ${targetUser.username}`)
      .setColor("#00F0FF")
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .setDescription(
        `**${targetUser.username}** has a total of **${stats.total} valid invites**! 🚀\n\n` +
          `📊 **Detailed Statistics:**\n` +
          `• 🟢 **Verified Members:** \`${stats.regular || 0}\`\n` +
          `• 🔴 **Leaves:** \`${stats.left || 0}\`\n` +
          `• 🎁 **Bonus Invites:** \`${stats.bonus || 0}\`\n` +
          `• ✨ **Total Score:** \`${stats.total}\`\n\n` +
          `💡 *Invite more friends to climb into the Top 5 for free Netflix, Minecraft & Nitro!*`
      )
      .setFooter({ text: "LM Shop • https://lmshop.netlify.app" })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  if (content.startsWith("!addinvites")) {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ This command is restricted to the **Server Owner** and **Admins**!");
    }
    const parts = message.content.split(/\s+/);
    const targetUser = message.mentions.users.first();
    const amount = parseInt(parts[2], 10);

    if (!targetUser || isNaN(amount)) {
      return message.reply("Usage: `!addinvites @user 5`");
    }

    if (!db.users[targetUser.id]) {
      db.users[targetUser.id] = { regular: 0, bonus: 0, left: 0, fake: 0 };
    }
    db.users[targetUser.id].bonus = (db.users[targetUser.id].bonus || 0) + amount;
    saveDB(db);

    const stats = getUserStats(db, targetUser.id);
    updateLiveLeaderboard();

    return message.reply(`✓ **${amount} bonus invites** added to <@${targetUser.id}>. New total: **${stats.total} invites**!`);
  }

  if (content === "!resetinvites") {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ This command is restricted to the **Server Owner** and **Admins**!");
    }
    db.users = {};
    db.joins = {};
    db.pendingJoins = {};
    saveDB(db);
    updateLiveLeaderboard();

    return message.reply("🚨 **All invites have been reset for the new round!** Everyone starts back at 0.");
  }
});

// Start Client
const token = process.env.DISCORD_TOKEN;
if (!token || token === "JOUW_DISCORD_BOT_TOKEN_HIER") {
  console.log("\n========================================================");
  console.log("⚠️ Please enter your Discord Bot Token in the .env file!");
  console.log("========================================================\n");
} else {
  client.login(token);
}
