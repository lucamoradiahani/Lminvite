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

// Load DB
function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = { users: {}, joins: {}, pendingJoins: {}, liveMessage: null, completedTickets: {} };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (!data.users) data.users = {};
    if (!data.joins) data.joins = {};
    if (!data.pendingJoins) data.pendingJoins = {};
    if (!data.completedTickets) data.completedTickets = {};
    if (data.liveMessage === undefined) data.liveMessage = null;
    return data;
  } catch (err) {
    console.error("Error loading database:", err);
    return { users: {}, joins: {}, pendingJoins: {}, liveMessage: null, completedTickets: {} };
  }
}

// Save DB
function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving database:", err);
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

// Helper to build leaderboard embed
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
  desc += `🌐 **Webshop:** [https://lmshop.netlify.app](https://lmshop.netlify.app)\n`;
  desc += `🤖 ・ **Check your invites at ${botCmdMention}** *(typ \`/invites\`)*\n`;
  desc += `🔄 *Dit leaderboard wordt elke 60 seconden automatisch live ververst.*`;

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

// ── Helper: Create Ticket Done Embed and Action Row ──
function createTicketDoneMessage() {
  const embed = new EmbedBuilder()
    .setTitle("✅ Ticket Completed")
    .setColor("#2ED573")
    .setDescription(
      "Your order has been successfully completed and delivered.\n\n" +
      "If you run into any issues, please open a new ticket — completed tickets are archived and are usually not monitored further.\n\n" +
      "❤️ **We'd love your feedback!** Click the button below to leave a review. If no review is submitted within **24 hours**, an automatic review will be posted on your behalf."
    )
    .setFooter({ text: "LM Shop • Customer Support • https://lmshop.netlify.app" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close_btn")
      .setLabel("Close Ticket")
      .setEmoji("⭐")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ticket_need_help_btn")
      .setLabel("Still need help")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// ── 24-Hour Auto-Close & Auto-Review Checker (Runs every 60 seconds) ──
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

        // Find Vouches Channel
        const vouchChannel = guild.channels.cache.find(
          (c) =>
            c.isTextBased() &&
            (c.name.includes("vouch") ||
              c.name.includes("review") ||
              c.name.includes("vouches") ||
              c.name.includes("✅┃vouches"))
        );

        if (vouchChannel) {
          const autoVouchEmbed = new EmbedBuilder()
            .setTitle("⭐ Automated Customer Review")
            .setColor("#5865F2")
            .setDescription(
              `⭐⭐⭐⭐⭐ **(5/5 Stars)**\n\n` +
              `> *This is an automated review generated because no feedback was submitted within 24 hours of the order being marked as completed. Thank you for choosing LM Shop!*`
            )
            .addFields(
              { name: "Channel", value: channel ? `#${channel.name}` : "Ticket", inline: true },
              { name: "Status", value: "✅ Auto-Delivered & Closed", inline: true }
            )
            .setFooter({ text: "LM Shop • https://lmshop.netlify.app" })
            .setTimestamp();

          await vouchChannel.send({ embeds: [autoVouchEmbed] }).catch(() => null);
        }

        if (channel) {
          await channel.send("⏳ **24 hours have passed without a review.** An automated 5-star review has been posted. This ticket is now closing...").catch(() => null);
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

  // Cache invites for all guilds
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const firstInvites = await guild.invites.fetch();
      const codeUses = new Map();
      firstInvites.each((inv) => codeUses.set(inv.code, inv.uses));
      guildInvites.set(guildId, codeUses);
      console.log(`✓ Invites loaded for guild: ${guild.name} (${firstInvites.size} invites)`);
    } catch (err) {
      console.warn(`Could not load invites for guild ${guild.name}:`, err.message);
    }
  }

  // Register Slash Commands
  const commands = [
    new SlashCommandBuilder()
      .setName("done")
      .setDescription("Mark this ticket as completed, request customer review, and auto-close (Owner/Admin only)"),
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
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✓ Slash commands successfully registered (including /done)!");
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
  const inviterId = db.joins[member.id];

  if (inviterId && db.users[inviterId]) {
    db.users[inviterId].left = (db.users[inviterId].left || 0) + 1;
    delete db.joins[member.id];
    saveDB(db);

    const stats = getUserStats(db, inviterId);
    console.log(`[-] ${member.user.tag} left. Inviter ${inviterId} now has ${stats.total} invites.`);
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
        content: `✅ **Thank you for your review!** Your feedback has been published to ${vouchChannel ? `<#${vouchChannel.id}>` : "the vouches channel"}.\n\n🔒 *This ticket will automatically close in 5 seconds...*`,
      });

      setTimeout(() => {
        interaction.channel.delete("Customer reviewed and closed ticket").catch(() => null);
      }, 5000);

      return;
    }
  }

  // 2. Button Clicks (Close Ticket or Still Need Help)
  if (interaction.isButton()) {
    if (interaction.customId === "ticket_close_btn") {
      const modal = new ModalBuilder()
        .setCustomId("ticket_review_modal")
        .setTitle("Leave a Review & Close Ticket");

      const ratingInput = new TextInputBuilder()
        .setCustomId("review_rating")
        .setLabel("Rating (1 to 5 Stars)")
        .setPlaceholder("Enter 1, 2, 3, 4 or 5")
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(1)
        .setRequired(true)
        .setValue("5");

      const feedbackInput = new TextInputBuilder()
        .setCustomId("review_feedback")
        .setLabel("Your Feedback / Comments")
        .setPlaceholder("Write your feedback here (e.g. Fast delivery, awesome service!)")
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
        content: "👋 **Ticket status updated!** Support has been notified that you still need help.",
        ephemeral: true,
      });

      return interaction.channel.send({
        content: `👋 <@${interaction.user.id}> indicates they still need help. Our support team will assist you shortly! Please describe what else you need.`,
      });
    }
  }

  // 3. Slash Commands
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const member = interaction.member;

  // /done (Owner & Admins only)
  if (commandName === "done") {
    if (!isOwnerOrStar(member)) {
      return interaction.reply({
        content: "❌ This command is restricted to the **Server Owner** and **Admins**!",
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
        content: `❌ Dit commando is uitsluitend toegestaan voor de **Server Owner** en de **⭐ / * (Sterretje)** rol!`,
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
      content: `✓ **Live Leaderboard ingesteld in <#${interaction.channel.id}>!**\nDit bericht wordt elke 60 seconden automatisch live ververst.`,
      ephemeral: true,
    });
  }

  // /invites (Members, Boosters, Customers)
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
      .setFooter({ text: "LM Shop • https://lmshop.netlify.app" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // /addinvites (Owner & * only)
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
    });
  }

  // /resetinvites (Owner & * only)
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

// ── Prefix Commands (!done, !leaderboard, !invites, !setleaderboard, !addinvites, !resetinvites) ──
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.toLowerCase().trim();
  const db = loadDB();
  const member = message.member;

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
      .setFooter({ text: "LM Shop • https://lmshop.netlify.app" })
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
