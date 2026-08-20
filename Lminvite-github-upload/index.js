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
    console.log(`✓ HTTP Keep-Alive server actief op poort ${PORT}`);
  });

// Database file
const DB_FILE = path.join(__dirname, "invites.json");

// Load DB
function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = { users: {}, joins: {}, pendingJoins: {}, liveMessage: null };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (!data.users) data.users = {};
    if (!data.joins) data.joins = {};
    if (!data.pendingJoins) data.pendingJoins = {};
    if (data.liveMessage === undefined) data.liveMessage = null;
    return data;
  } catch (err) {
    console.error("Fout bij laden van database:", err);
    return { users: {}, joins: {}, pendingJoins: {}, liveMessage: null };
  }
}

// Save DB
function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Fout bij opslaan van database:", err);
  }
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

  // 3. Exact role match only (NEVER partial substring matching)
  const roleNames = member.roles.cache.map((r) => r.name.toLowerCase().trim());
  return roleNames.some(
    (name) =>
      name === "*" ||
      name === "⭐" ||
      name === "sterretje" ||
      name === "owner" ||
      name === "eigenaar" ||
      name === "co-owner" ||
      name === "head admin"
  );
}

function hasInvitesPermission(member) {
  if (!member || !member.guild) return false;
  // Server Owner or Admin always has access
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  // Exact matching for Member, Booster, Customer
  const roleNames = member.roles.cache.map((r) => r.name.toLowerCase().trim());
  return roleNames.some(
    (name) =>
      name === "member" ||
      name === "members" ||
      name === "lid" ||
      name === "leden" ||
      name === "geverifieerd" ||
      name === "verified" ||
      name === "customer" ||
      name === "customers" ||
      name === "klant" ||
      name === "klanten" ||
      name === "buyer" ||
      name === "buyers" ||
      name === "booster" ||
      name === "boosters" ||
      name === "server booster" ||
      name === "nitro booster" ||
      name === "*" ||
      name === "owner"
  );
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

// Helper to build leaderboard embed
function createLeaderboardEmbed(guild, db) {
  // Calculate sorted leaderboard
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

  // Find bot-commands channel if present
  const botCmdChannel = guild.channels.cache.find(
    (c) => c.isTextBased() && (c.name.includes("bot-command") || c.name.includes("commands") || c.name.includes("bot"))
  );
  const botCmdMention = botCmdChannel ? `<#${botCmdChannel.id}>` : "`#bot-commands`";

  let desc = `🏆 **LM SHOP MAANDELIJKS INVITE LEADERBOARD** 🏆\n\n`;
  desc += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  desc += `🎁 **BELONINGEN BIJ DE MAANDELIJKSE RESET:**\n`;
  desc += `🥇 **#1 Spot:** 🚀 **Discord Nitro** + 🎮 **Minecraft FA** + 🍿 **Netflix Key**\n`;
  desc += `🥈 **#2 & #3 Spot:** 🎮 **Minecraft FA** + 🍿 **Netflix Key**\n`;
  desc += `🥉 **#4 & #5 Spot:** 🍿 **Netflix Key**\n`;
  desc += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (top10.length === 0 || top10.every((e) => e.total === 0)) {
    desc += `*Nog geen invites geregistreerd. Wees de eerste die vrienden uitnodigt en pak direct de #1 positie! ⚡*\n`;
  } else {
    top10.forEach((entry, idx) => {
      let medal = `**#${idx + 1}**`;
      if (idx === 0) medal = `🥇 **#1**`;
      else if (idx === 1) medal = `🥈 **#2**`;
      else if (idx === 2) medal = `🥉 **#3**`;
      else if (idx === 3) medal = `🏅 **#4**`;
      else if (idx === 4) medal = `🏅 **#5**`;

      desc += `${medal} <@${entry.userId}> — **${entry.total} invites** *(+${entry.regular} geverifieerd, -${entry.left} leavede, +${entry.bonus} bonus)*\n`;
    });
  }

  desc += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  desc += `🌐 **Webshop:** [https://lmshhop.netlify.app](https://lmshhop.netlify.app)\n`;
  desc += `🤖 ・ **Check your invites at ${botCmdMention}** *(typ \`/invites\`)*\n`;
  desc += `🔄 *Dit leaderboard wordt elke 60 seconden automatisch live ververst.*`;

  return new EmbedBuilder()
    .setTitle("👑 LM Shop — Top 10 Invites Leaderboard")
    .setColor("#5865F2")
    .setDescription(desc)
    .setThumbnail(guild.iconURL({ dynamic: true }) || "https://lmshhop.netlify.app/favicon.svg")
    .setFooter({ text: "LM Shop • Live Realtime Auto-Update", iconURL: "https://lmshhop.netlify.app/favicon.svg" })
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
    console.error("Fout bij live leaderboard auto-update:", err.message);
  }
}

// ── Bot Ready & Slash Command Registration ──
client.once("ready", async () => {
  console.log(`✓ Bot is ingelogd als ${client.user.tag}!`);
  client.user.setActivity("lmshhop.netlify.app 🛒 | /leaderboard", { type: 3 });

  // Cache invites for all guilds
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const firstInvites = await guild.invites.fetch();
      const codeUses = new Map();
      firstInvites.each((inv) => codeUses.set(inv.code, inv.uses));
      guildInvites.set(guildId, codeUses);
      console.log(`✓ Invites geladen voor server: ${guild.name} (${firstInvites.size} invites)`);
    } catch (err) {
      console.warn(`Kon invites niet laden voor server ${guild.name}:`, err.message);
    }
  }

  // Register Slash Commands
  const commands = [
    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("Bekijk de Top 10 Invite Leaderboard en de prijzenpot"),
    new SlashCommandBuilder()
      .setName("setleaderboard")
      .setDescription("Plaats een live automatisch verversend leaderboard in dit kanaal (Alleen Owner / *)"),
    new SlashCommandBuilder()
      .setName("invites")
      .setDescription("Bekijk jouw aantal invites (Alleen voor Members, Boosters en Customers)")
      .addUserOption((option) =>
        option.setName("user").setDescription("Het lid waarvan je de invites wilt checken").setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("addinvites")
      .setDescription("Voeg bonus invites toe aan een lid (Alleen Owner / *)")
      .addUserOption((option) => option.setName("user").setDescription("Het lid").setRequired(true))
      .addIntegerOption((option) => option.setName("aantal").setDescription("Aantal bonus invites").setRequired(true)),
    new SlashCommandBuilder()
      .setName("resetinvites")
      .setDescription("Reset alle invites voor een nieuwe maand/ronde (Alleen Owner / *)"),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log("Slash commands registreren...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✓ Slash commands succesvol geregistreerd!");
  } catch (err) {
    console.error("Fout bij registreren slash commands:", err);
  }

  // Start 60-second live auto-updater
  setInterval(updateLiveLeaderboard, 60 * 1000);
  console.log("✓ Live Leaderboard Auto-Updater actief (elke 60s)!");
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

      // Update cache
      const codeUses = new Map();
      newInvites.each((inv) => codeUses.set(inv.code, inv.uses));
      guildInvites.set(member.guild.id, codeUses);
    }

    if (usedInvite && usedInvite.inviter) {
      const inviterId = usedInvite.inviter.id;

      // Prevent self-inviting
      if (inviterId === member.id) {
        console.log(`${member.user.tag} joinde met zijn eigen invite link.`);
        return;
      }

      // Check if user is pending screening / verification
      if (member.pending) {
        // User has not yet accepted rules/verification -> store as pending
        if (!db.pendingJoins) db.pendingJoins = {};
        db.pendingJoins[member.id] = inviterId;
        saveDB(db);
        console.log(`[⏳] ${member.user.tag} ge-invite door ${usedInvite.inviter.tag} (In afwachting van verificatie/regels).`);
      } else {
        // User is already a full member -> count immediately!
        if (!db.users[inviterId]) {
          db.users[inviterId] = { regular: 0, bonus: 0, left: 0, fake: 0 };
        }
        db.users[inviterId].regular = (db.users[inviterId].regular || 0) + 1;
        db.joins[member.id] = inviterId;
        saveDB(db);

        const stats = getUserStats(db, inviterId);
        console.log(`[+] ${member.user.tag} is direct geregistreerd als member voor ${usedInvite.inviter.tag} (Totaal: ${stats.total})`);
        updateLiveLeaderboard();
      }
    } else {
      console.log(`[+] ${member.user.tag} joinde via vanity URL of directe link.`);
    }
  } catch (err) {
    console.error("Fout bij join tracking:", err);
  }
});

// ── Member Update Tracker (Verification / Screening Completed) ──
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  // Check if member just completed screening (passed rules/verification)
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
      console.log(`[✓] ${newMember.user.tag} heeft verificatie voltooid! Geregistreerd voor inviter ${inviterId} (Totaal: ${stats.total})`);
      updateLiveLeaderboard();
    }
  }
});

// ── Member Leave Tracker ──
client.on("guildMemberRemove", async (member) => {
  const db = loadDB();
  const inviterId = db.joins[member.id];

  if (inviterId && db.users[inviterId]) {
    db.users[inviterId].left = (db.users[inviterId].left || 0) + 1;
    delete db.joins[member.id];
    saveDB(db);

    const stats = getUserStats(db, inviterId);
    console.log(`[-] ${member.user.tag} heeft de server verlaten. Inviter ${inviterId} heeft nu ${stats.total} geldige invites.`);
    updateLiveLeaderboard();
  } else if (db.pendingJoins && db.pendingJoins[member.id]) {
    delete db.pendingJoins[member.id];
    saveDB(db);
    console.log(`[-] Onvoltooide bezoeker ${member.user.tag} heeft de server verlaten voor verificatie.`);
  }
});

// ── Slash Commands ──
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const db = loadDB();
  const member = interaction.member;

  // /leaderboard (Alleen voor Owner & *)
  if (commandName === "leaderboard") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: `❌ Dit commando is uitsluitend toegestaan voor de **Server Owner** en de **⭐ / * (Sterretje)** rol!`,
        ephemeral: true,
      });
    }
    const embed = createLeaderboardEmbed(interaction.guild, db);
    return interaction.reply({ embeds: [embed] });
  }

  // /setleaderboard (Alleen voor Owner & *)
  if (commandName === "setleaderboard") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: `❌ Dit commando is uitsluitend toegestaan voor de **Server Owner** en de **⭐ / * (Sterretje)** rol!`,
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
      content: `✓ **Live Leaderboard succesvol ingesteld in <#${interaction.channel.id}>!**\nDit bericht wordt vanaf nu **elke 60 seconden** en direct bij elke join/leave automatisch live bijgewerkt.`,
      ephemeral: true,
    });
  }

  // /invites (Alleen voor Members, Boosters en Customers)
  if (commandName === "invites") {
    if (!hasInvitesPermission(member)) {
      return interaction.reply({
        content: `❌ Dit commando is alleen beschikbaar voor **Members**, **Boosters** en **Customers**!`,
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser("user") || interaction.user;
    const stats = getUserStats(db, targetUser.id);

    const embed = new EmbedBuilder()
      .setTitle(`📨 Invites van ${targetUser.username}`)
      .setColor("#00F0FF")
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .setDescription(
        `**${targetUser.username}** heeft in totaal **${stats.total} geldige invites**! 🚀\n\n` +
          `📊 **Gedetailleerde Statistieken:**\n` +
          `• 🟢 **Geverifieerde Members:** \`${stats.regular || 0}\`\n` +
          `• 🔴 **Verlaten (Leaves):** \`${stats.left || 0}\`\n` +
          `• 🎁 **Bonus Invites:** \`${stats.bonus || 0}\`\n` +
          `• ✨ **Totale Score:** \`${stats.total}\`\n\n` +
          `💡 *Nodig meer vrienden uit om te stijgen naar de Top 5 voor gratis Netflix, Minecraft & Nitro!*`
      )
      .setFooter({ text: "LM Shop • https://lmshhop.netlify.app" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // /addinvites (Alleen voor Owner & *)
  if (commandName === "addinvites") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: `❌ Dit commando is uitsluitend toegestaan voor de **Server Owner** en de **⭐ / * (Sterretje)** rol!`,
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("aantal");

    if (!db.users[targetUser.id]) {
      db.users[targetUser.id] = { regular: 0, bonus: 0, left: 0, fake: 0 };
    }
    db.users[targetUser.id].bonus = (db.users[targetUser.id].bonus || 0) + amount;
    saveDB(db);

    const stats = getUserStats(db, targetUser.id);
    updateLiveLeaderboard();

    return interaction.reply({
      content: `✓ **${amount} bonus invites** toegevoegd aan <@${targetUser.id}>. Nieuw totaal: **${stats.total} invites**!`,
      ephemeral: true,
    });
  }

  // /resetinvites (Alleen voor Owner & *)
  if (commandName === "resetinvites") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: `❌ Dit commando is uitsluitend toegestaan voor de **Server Owner** en de **⭐ / * (Sterretje)** rol!`,
        ephemeral: true,
      });
    }

    db.users = {};
    db.joins = {};
    db.pendingJoins = {};
    saveDB(db);
    updateLiveLeaderboard();

    return interaction.reply({
      content: `🚨 **Alle invites zijn gereset voor de nieuwe ronde!** Iedereen begint weer op 0.`,
    });
  }
});

// ── Prefix Commands (!leaderboard, !invites, !setleaderboard, !addinvites, !resetinvites) ──
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.toLowerCase().trim();
  const db = loadDB();
  const member = message.member;

  if (content === "!setleaderboard") {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ Dit commando is alleen toegestaan voor de **Server Owner** en de **⭐ / * (Sterretje)** rol!");
    }

    const embed = createLeaderboardEmbed(message.guild, db);
    const sentMsg = await message.channel.send({ embeds: [embed] });

    db.liveMessage = {
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: sentMsg.id,
    };
    saveDB(db);

    return message.reply("✓ **Live Leaderboard ingesteld!** Wordt elke 60 seconden automatisch ververst.");
  }

  if (content === "!leaderboard" || content === "!top") {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ Dit commando is uitsluitend toegestaan voor de **Server Owner** en de **⭐ / * (Sterretje)** rol!");
    }
    const embed = createLeaderboardEmbed(message.guild, db);
    return message.reply({ embeds: [embed] });
  }

  if (content.startsWith("!invites") || content.startsWith("!invite")) {
    if (!hasInvitesPermission(member)) {
      return message.reply("❌ Dit commando is alleen beschikbaar voor **Members**, **Boosters** en **Customers**!");
    }

    const targetUser = message.mentions.users.first() || message.author;
    const stats = getUserStats(db, targetUser.id);

    const embed = new EmbedBuilder()
      .setTitle(`📨 Invites van ${targetUser.username}`)
      .setColor("#00F0FF")
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .setDescription(
        `**${targetUser.username}** heeft in totaal **${stats.total} geldige invites**! 🚀\n\n` +
          `📊 **Gedetailleerde Statistieken:**\n` +
          `• 🟢 **Geverifieerde Members:** \`${stats.regular || 0}\`\n` +
          `• 🔴 **Verlaten (Leaves):** \`${stats.left || 0}\`\n` +
          `• 🎁 **Bonus Invites:** \`${stats.bonus || 0}\`\n` +
          `• ✨ **Totale Score:** \`${stats.total}\`\n\n` +
          `💡 *Typ \`!leaderboard\` om de Top 10 en prijzen te zien!*`
      )
      .setFooter({ text: "LM Shop • https://lmshhop.netlify.app" })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  if (content.startsWith("!addinvites")) {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ Dit commando is uitsluitend toegestaan voor de **Server Owner** en de **⭐ / * (Sterretje)** rol!");
    }
    const parts = message.content.split(/\s+/);
    const targetUser = message.mentions.users.first();
    const amount = parseInt(parts[2], 10);

    if (!targetUser || isNaN(amount)) {
      return message.reply("Gebruik: `!addinvites @user 5`");
    }

    if (!db.users[targetUser.id]) {
      db.users[targetUser.id] = { regular: 0, bonus: 0, left: 0, fake: 0 };
    }
    db.users[targetUser.id].bonus = (db.users[targetUser.id].bonus || 0) + amount;
    saveDB(db);

    const stats = getUserStats(db, targetUser.id);
    updateLiveLeaderboard();

    return message.reply(`✓ **${amount} bonus invites** toegevoegd aan <@${targetUser.id}>. Nieuw totaal: **${stats.total} invites**!`);
  }

  if (content === "!resetinvites") {
    if (!isOwnerOrStar(member)) {
      return message.reply("❌ Dit commando is uitsluitend toegestaan voor de **Server Owner** en de **⭐ / * (Sterretje)** rol!");
    }
    db.users = {};
    db.joins = {};
    db.pendingJoins = {};
    saveDB(db);
    updateLiveLeaderboard();

    return message.reply("🚨 **Alle invites zijn gereset voor de nieuwe ronde!** Iedereen begint weer op 0.");
  }
});

// Start Client
const token = process.env.DISCORD_TOKEN;
if (!token || token === "JOUW_DISCORD_BOT_TOKEN_HIER") {
  console.log("\n========================================================");
  console.log("⚠️ Vul jouw Discord Bot Token in in het .env bestand!");
  console.log("========================================================\n");
} else {
  client.login(token);
}
