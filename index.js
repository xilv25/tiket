require("dotenv").config();
const {
  Client, GatewayIntentBits, Partials,
  PermissionsBitField, ChannelType,
  EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
  SlashCommandBuilder, REST, Routes,
  PermissionFlagsBits
} = require("discord.js");
const express = require("express");

// Replit keep-alive
const app = express();
app.get("/", (_, res) => res.send("Bot Alive ✅"));
app.listen(3000, () => console.log("Keep-alive web running"));

const {
  DISCORD_TOKEN, CLIENT_ID, GUILD_ID,
  STAFF_ROLE_ID
} = process.env;

const BUYER_ROLE_ID = "1422860004632825897"; // role buyer

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

// ===== States =====
let ticketQueue = [];           

// ===== Embeds =====
function buildTicketEmbed(userId, ticketNum) {
  return new EmbedBuilder()
    .setTitle(`🎟️ Ticket #${ticketNum} — <@${userId}>`)
    .setColor("#2ECC71")
    .setDescription(
      `Halo <@${userId}>, terima kasih telah membuat tiket di **LimeHub**.\n\n` +
      `💵 **Harga Script:** \`Rp 30.000\`\n\n` +
      `Silakan lakukan pembayaran ke salah satu metode berikut:\n\n` +
      `🔗 **QRIS** → [Klik di sini untuk scan](https://shinzux.vercel.app/image_4164bbec-5215-4e0c-98ca-d4c198a10c9e.png)\n` +
      `🔗 **PayPal** → [Klik di sini untuk bayar](https://www.paypal.me/RizkiJatiPrasetyo)\n\n` +
      `⚠️ Setelah melakukan pembayaran, **WAJIB** upload bukti transfer berupa screenshot di channel ini.\n` +
      `Tiket kamu akan diproses oleh staff setelah bukti diterima.`
    )
    .setThumbnail("https://shinzux.vercel.app/image_4164bbec-5215-4e0c-98ca-d4c198a10c9e.png")
    .setFooter({ text: "made by @unstoppable_neid", iconURL: client.user.displayAvatarURL() });
}

function buildQueueEmbed(userId, ticketNum, pos, total, nextTicketNum) {
  const statusLine = pos === 1
    ? `+ 🚀 POSISI: #${pos} dari ${total}`
    : `- ⏳ POSISI: #${pos} dari ${total}`;

  return new EmbedBuilder()
    .setTitle("📊 STATUS ANTRIAN")
    .setColor(pos === 1 ? "Green" : "Red")
    .setDescription(
      `Halo <@${userId}>, bukti pembayaran kamu sudah diterima ✅\n\n` +
      `__**POSISI ANTRIAN ANDA**__\n` +
      `\`\`\`diff\n${statusLine}\n\`\`\`\n` +
      (nextTicketNum && nextTicketNum !== ticketNum
        ? `🔜 Setelah ini staff akan mengurus: **Ticket #${nextTicketNum}**`
        : `✨ Tiket kamu akan diproses sebentar lagi!`)
    )
    .setFooter({ text: "made by @unstoppable_neid" });
}

// ===== Update helpers =====
async function updateQueueEmbeds(guild) {
  for (let i = 0; i < ticketQueue.length; i++) {
    const t = ticketQueue[i];
    const chan = guild.channels.cache.get(t.channelId);
    if (!chan) continue;
    try {
      const msg = await chan.messages.fetch(t.messageId);
      const nextTicketNum = ticketQueue[0]?.ticketNum;
      const newEmbed = buildQueueEmbed(t.userId, t.ticketNum, i + 1, ticketQueue.length, nextTicketNum);
      await msg.edit({ embeds: [newEmbed] });
    } catch {}
  }
}

// ===== Slash Commands =====
const commands = [
  new SlashCommandBuilder().setName("setup").setDescription("Pasang panel tiket")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("on").setDescription("Set status on-duty (dummy, tanpa embed staff)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName("off").setDescription("Set status off-duty (dummy, tanpa embed staff)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Slash commands registered ✅");
}

// ===== Ready =====
client.once("ready", async () => {
  console.log(`${client.user.tag} is online 🚀`);
  await registerCommands();
});

// ===== Interaction =====
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup") {
        const panel = new EmbedBuilder()
          .setTitle("🎟️ LimeHub Ticket Panel")
          .setDescription("Klik tombol di bawah untuk membuat tiket baru.")
          .setFooter({ text: "made by @unstoppable_neid" });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("create_ticket").setLabel("Create Ticket").setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ content: "Panel tiket dipasang ✅", ephemeral: true });
        return interaction.channel.send({ embeds: [panel], components: [row] });
      }

      if (interaction.commandName === "on") {
        await interaction.reply({ content: `✅ Kamu sekarang **ON-DUTY**. (status dummy, embed staff sudah dihapus)`, ephemeral: true });
      }

      if (interaction.commandName === "off") {
        await interaction.reply({ content: `🛑 Kamu sekarang **OFF-DUTY**. (status dummy, embed staff sudah dihapus)`, ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "create_ticket") {
        await interaction.deferReply({ ephemeral: true });

        const existing = interaction.guild.channels.cache.find(
          c => c.name.startsWith("ticket-") && c.permissionsFor(interaction.user.id)?.has(PermissionsBitField.Flags.ViewChannel)
        );
        if (existing) {
          return interaction.editReply({ content: `❌ Kamu sudah punya tiket aktif: ${existing}` });
        }

        const allTickets = interaction.guild.channels.cache
          .filter(c => c.name.startsWith("ticket-") || c.name.startsWith("closed-"))
          .map(c => parseInt(c.name.split("-")[1]))
          .filter(n => !isNaN(n));
        const nextNumber = allTickets.length > 0 ? Math.max(...allTickets) + 1 : 1;
        const ticketName = `ticket-${nextNumber}`;

        const overwrites = [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ];
        if (STAFF_ROLE_ID) {
          overwrites.push({ id: String(STAFF_ROLE_ID), allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
        }

        const chan = await interaction.guild.channels.create({ name: ticketName, type: ChannelType.GuildText, permissionOverwrites: overwrites });

        const ticketEmbed = buildTicketEmbed(interaction.user.id, nextNumber);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("claim_ticket").setLabel("Claim Ticket").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
        );

        await chan.send({ embeds: [ticketEmbed], components: [row] });
        return interaction.editReply({ content: `✅ Tiket berhasil dibuat: ${chan}` });
      }

      if (interaction.customId === "claim_ticket") {
        if (!interaction.member.roles.cache.has(String(STAFF_ROLE_ID))) {
          return interaction.reply({ content: "❌ Hanya staff yang bisa claim tiket.", ephemeral: true });
        }
        await interaction.deferUpdate();
        const channel = interaction.channel;
        const buyer = channel.members.find(m => !m.user.bot && !m.roles.cache.has(String(STAFF_ROLE_ID)));

        if (buyer) { try { await buyer.roles.add(BUYER_ROLE_ID); } catch {} }

        const claimEmbed = new EmbedBuilder()
          .setTitle("🛠️ Ticket Processing")
          .setDescription(`Tiket ini sedang diproses oleh <@${interaction.user.id}>.\n\nHalo <@${buyer?.id}>, mohon tunggu ya!`)
          .setColor("Yellow");
        await channel.send({ embeds: [claimEmbed] });

        setTimeout(async () => {
          const nextTicketNum = ticketQueue[1]?.ticketNum;
          const doneEmbed = new EmbedBuilder()
            .setTitle("✅ Ticket Done")
            .setDescription(
              `Halo <@${buyer?.id}>, tiket ini sudah selesai.\n\n` +
              `Silakan lanjut ke channel <#1433394924727832638>\n\n` +
              `Coba ketik \`!command\` biar tau semua info yang kamu cari!\n\n` +
              (nextTicketNum ? `👀 Staff, selanjutnya silakan urus: **Ticket #${nextTicketNum}**` : "")
            )
            .setColor("Green");
          await channel.send({ embeds: [doneEmbed] });
          if (buyer) { try { await buyer.send({ embeds: [doneEmbed] }); } catch {} }
        }, 5000);

        setTimeout(async () => {
          ticketQueue = ticketQueue.filter(t => t.channelId !== channel.id);
          updateQueueEmbeds(interaction.guild);
          await channel.delete().catch(() => {});
        }, 60 * 1000);
      }

      if (interaction.customId === "close_ticket") {
        if (!interaction.member.roles.cache.has(String(STAFF_ROLE_ID))) {
          return interaction.reply({ content: "❌ Hanya staff yang bisa close tiket.", ephemeral: true });
        }
        await interaction.deferUpdate();
        ticketQueue = ticketQueue.filter(t => t.channelId !== interaction.channel.id);
        updateQueueEmbeds(interaction.guild);
        await interaction.channel.delete().catch(() => {});
      }
    }
  } catch {}
});

// === Bukti TF ===
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.channel.name.startsWith("ticket-")) return;
  if (msg.attachments.size === 0) return;

  const guild = msg.guild;
  const channel = msg.channel;
  const ticketNum = parseInt(channel.name.split("-")[1]) || "?";

  const idxExisting = ticketQueue.findIndex(t => t.channelId === channel.id);
  const pos   = idxExisting === -1 ? ticketQueue.length + 1 : idxExisting + 1;
  const total = idxExisting === -1 ? ticketQueue.length + 1 : ticketQueue.length;

  const queueEmbed = buildQueueEmbed(msg.author.id, ticketNum, pos, total, ticketQueue[0]?.ticketNum);
  let entry = ticketQueue.find(t => t.channelId === channel.id);

  if (entry) {
    const msgToEdit = await channel.messages.fetch(entry.messageId).catch(() => null);
    if (msgToEdit) await msgToEdit.edit({ embeds: [queueEmbed] });
    else {
      const sentQueue = await channel.send({ embeds: [queueEmbed] });
      entry.messageId = sentQueue.id;
    }
  } else {
    const sentQueue = await channel.send({ embeds: [queueEmbed] });
    entry = { channelId: channel.id, messageId: sentQueue.id, userId: msg.author.id, ticketNum };
    ticketQueue.push(entry);
  }

  updateQueueEmbeds(guild); 
});

client.login(process.env.DISCORD_TOKEN);
