require("dotenv").config();
const { Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require("discord.js");
const express = require("express");
const mongoose = require("mongoose");

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  MONGO_URI,
  QRIS_URL,
  PAYPAL_URL,
  STAFF_ROLE_ID,
  ONDUTY_ROLE_ID
} = process.env;

// --- Keep-alive for Replit ---
const app = express();
app.get("/", (_, res) => res.send("LimeHub Ticket Bot alive"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Web keep-alive on :" + PORT));

// --- Mongo Schemas ---
mongoose.set("strictQuery", true);
mongoose.connect(MONGO_URI).then(()=>console.log("MongoDB connected")).catch(e=>console.error("Mongo DB error", e));

const ticketSchema = new mongoose.Schema({
  guildId: String,
  channelId: String,
  userId: String,
  status: { type: String, enum: ["open","awaiting_txid","paid","processing","closed"], default: "open" },
  txid: { type: String, default: null },
  queueNumber: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now }
});
const Ticket = mongoose.model("Ticket", ticketSchema);

const txidSchema = new mongoose.Schema({
  guildId: String,
  txid: { type: String, index: true },
  ticketId: String,
  createdAt: { type: Date, default: Date.now }
});
const Txid = mongoose.model("Txid", txidSchema);

const settingsSchema = new mongoose.Schema({
  guildId: { type: String, unique: true },
  queueCounter: { type: Number, default: 0 },
  panelChannelId: { type: String, default: null }
});
const Settings = mongoose.model("Settings", settingsSchema);

// --- Discord Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

// --- Slash Commands ---
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Pasang panel tiket di channel ini.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Tag on-duty di tiket ini (staff only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription("Tutup tiket (staff only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Ubah status tiket (staff only).")
    .addStringOption(o=>o.setName("to").setDescription("paid / processing").setRequired(true).addChoices(
      {name:"paid", value:"paid"},
      {name:"processing", value:"processing"}
    ))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Slash commands registered.");
}

// --- Utils ---
function ticketIntroEmbed() {
  return new EmbedBuilder()
    .setTitle("Payment Instructions")
    .setDescription(
      [
        `Silakan lakukan pembayaran untuk pembelian script di **LimeHub**:`,
        `• **QRIS**: ${QRIS_URL || "(belum di-set)"}\n• **PayPal**: ${PAYPAL_URL || "(belum di-set)"}`,
        ``,
        `Setelah pembayaran, **WAJIB** kirim *Transaction ID* melalui tombol di bawah.`,
        `> Catatan: Bukti gambar saja **tidak diterima**. Bot akan menolak bila tanpa TXID.`,
      ].join("\n")
    )
    .setFooter({ text: "made by @unstoppable_neid" });
}

function waitingEmbed(queuePos, queueTotal) {
  return new EmbedBuilder()
    .setTitle("Proses!")
    .setDescription(`__Please wait, your ticket will be processed according to the queue order.__\nMohon bersabar, tiket anda akan kami kerjakan sesuai dengan urutan yang ada.`)
    .addFields(
      { name: "Queue", value: `Posisi Anda: **#${queuePos}** dari **${queueTotal}**`, inline: true },
      { name: "Status", value: "Paid ✅", inline: true }
    )
    .setFooter({ text: "made by @unstoppable_neid" });
}

function createPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("create_ticket").setLabel("Create Ticket").setStyle(ButtonStyle.Success)
  );
}

function txidRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("submit_txid").setLabel("Submit Transaction ID").setStyle(ButtonStyle.Primary)
  );
}

function staffRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mark_processing").setLabel("Mark Processing").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Close").setStyle(ButtonStyle.Danger)
  );
}

async function updateQueueEmbeds(guildId) {
  // Optional global updates if you later add a central queue message
  return;
}

// --- Ready ---
client.once("ready", async () => {
  console.log(`${client.user.tag} is online`);
  try { await registerCommands(); } catch (e) { console.error(e); }
});

// --- Interactions ---
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup") {
        const ch = interaction.channel;
        await Settings.updateOne(
          { guildId: interaction.guild.id },
          { $set: { panelChannelId: ch.id } },
          { upsert: true }
        );

        const panel = new EmbedBuilder()
          .setTitle("LimeHub — Ticket Panel")
          .setDescription("Klik tombol di bawah untuk membuat tiket pembelian script.\nBot akan memberi instruksi pembayaran dan memaksa input **Transaction ID**.")
          .setFooter({ text: "made by @unstoppable_neid" });

        await ch.send({ embeds: [panel], components: [createPanelRow()] });
        return interaction.reply({ content: "Panel tiket dipasang di channel ini ✅", ephemeral: true });
      }

      if (interaction.commandName === "onduty") {
        if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
          return interaction.reply({ content: "Command ini hanya untuk staff.", ephemeral: true });
        }
        if (!interaction.channel.name.startsWith("ticket-")) {
          return interaction.reply({ content: "Gunakan di dalam channel tiket.", ephemeral: true });
        }
        const mention = ONDUTY_ROLE_ID ? `<@&${ONDUTY_ROLE_ID}>` : "@on-duty";
        await interaction.reply({ content: `${mention} mohon pantau tiket ini.`, allowedMentions: { parse: ["roles"] } });
      }

      if (interaction.commandName === "status") {
        if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
          return interaction.reply({ content: "Command ini hanya untuk staff.", ephemeral: true });
        }
        const to = interaction.options.getString("to");
        const t = await Ticket.findOne({ channelId: interaction.channel.id, guildId: interaction.guild.id });
        if (!t) return interaction.reply({ content: "Tiket tidak ditemukan.", ephemeral: true });

        if (to === "processing") {
          t.status = "processing";
          await t.save();
          await interaction.reply({ content: "Status diubah ke **processing**.", ephemeral: true });
        } else if (to === "paid") {
          if (!t.queueNumber) {
            const s = await Settings.findOneAndUpdate(
              { guildId: interaction.guild.id },
              { $inc: { queueCounter: 1 } },
              { upsert: true, new: true }
            );
            t.queueNumber = s.queueCounter;
          }
          t.status = "paid";
          await t.save();

          const totalPaidOrProcessing = await Ticket.countDocuments({ guildId: interaction.guild.id, status: { $in: ["paid", "processing"] } });
          const pos = await Ticket.countDocuments({ guildId: interaction.guild.id, status: { $in: ["paid", "processing"] }, queueNumber: { $lte: t.queueNumber } });

          await interaction.channel.send({ content: ONDUTY_ROLE_ID ? `<@&${ONDUTY_ROLE_ID}>` : null, embeds: [waitingEmbed(pos, totalPaidOrProcessing)], components: [staffRow()], allowedMentions: { parse: ["roles"] } });
          await interaction.reply({ content: "Status diubah ke **paid** dan embed antrian dikirim.", ephemeral: true });
        }
      }

      if (interaction.commandName === "close") {
        if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
          return interaction.reply({ content: "Command ini hanya untuk staff.", ephemeral: true });
        }
        const t = await Ticket.findOne({ channelId: interaction.channel.id, guildId: interaction.guild.id });
        if (!t) return interaction.reply({ content: "Tiket tidak ditemukan.", ephemeral: true });

        t.status = "closed";
        await t.save();
        await interaction.reply({ content: "Tiket ditutup. Channel akan di-archive & di-lock.", ephemeral: true });

        try {
          await interaction.channel.permissionOverwrites.edit(t.userId, { ViewChannel: false, SendMessages: false });
          await interaction.channel.setName(`closed-${interaction.channel.name.replace("ticket-","")}`);
        } catch(e) { console.error(e); }
      }
      return;
    }

    if (interaction.isButton()) {
      // Create ticket
      if (interaction.customId === "create_ticket") {
        // Cegah banyak tiket aktif per user
        const existing = await Ticket.findOne({ guildId: interaction.guild.id, userId: interaction.user.id, status: { $in: ["open","awaiting_txid","paid","processing"] } });
        if (existing) {
          const ch = await interaction.guild.channels.fetch(existing.channelId).catch(()=>null);
          return interaction.reply({ content: `Kamu masih punya tiket aktif: ${ch ? ch : "`unknown`"} — tutup dulu sebelum bikin baru.`, ephemeral: true });
        }

        const name = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g,"");
        const chan = await interaction.guild.channels.create({
          name,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
          ]
        });

        await Ticket.create({
          guildId: interaction.guild.id,
          channelId: chan.id,
          userId: interaction.user.id,
          status: "awaiting_txid"
        });

        await chan.send({ content: `<@${interaction.user.id}> selamat datang di tiket pembelian script.`, embeds: [ticketIntroEmbed()], components: [txidRow()] });
        return interaction.reply({ content: `Tiket dibuat: ${chan}`, ephemeral: true });
      }

      if (interaction.customId === "submit_txid") {
        const modal = new ModalBuilder()
          .setCustomId("txid_modal")
          .setTitle("Submit Transaction ID");

        const tx = new TextInputBuilder()
          .setCustomId("txid_value")
          .setLabel("Transaction ID (WAJIB, tanpa spasi)")
          .setStyle(TextInputStyle.Short)
          .setMinLength(5)
          .setMaxLength(120)
          .setRequired(true);

        const row = new ActionRowBuilder().addComponents(tx);
        modal.addComponents(row);
        return interaction.showModal(modal);
      }

      if (interaction.customId === "mark_processing") {
        if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
          return interaction.reply({ content: "Hanya staff yang bisa ubah status.", ephemeral: true });
        }
        const t = await Ticket.findOne({ channelId: interaction.channel.id, guildId: interaction.guild.id });
        if (!t) return interaction.reply({ content: "Tiket tidak ditemukan.", ephemeral: true });
        t.status = "processing";
        await t.save();
        return interaction.reply({ content: "Status: **processing**. Lanjut kerjakan sesuai antrian.", ephemeral: true });
      }

      if (interaction.customId === "close_ticket") {
        if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
          return interaction.reply({ content: "Hanya staff yang bisa menutup tiket.", ephemeral: true });
        }
        const t = await Ticket.findOne({ channelId: interaction.channel.id, guildId: interaction.guild.id });
        if (!t) return interaction.reply({ content: "Tiket tidak ditemukan.", ephemeral: true });
        t.status = "closed";
        await t.save();

        await interaction.reply({ content: "Tiket ditutup. Channel akan di-archive & di-lock.", ephemeral: true });
        try {
          await interaction.channel.permissionOverwrites.edit(t.userId, { ViewChannel: false, SendMessages: false });
          await interaction.channel.setName(`closed-${interaction.channel.name.replace("ticket-","")}`);
        } catch(e) { console.error(e); }
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "txid_modal") {
      const txidVal = interaction.fields.getTextInputValue("txid_value").trim();
      const channel = interaction.channel;
      if (!channel || !channel.name?.startsWith("ticket-")) {
        return interaction.reply({ content: "Modal ini harus di dalam channel tiket.", ephemeral: true });
      }

      const t = await Ticket.findOne({ channelId: channel.id, guildId: interaction.guild.id, userId: interaction.user.id });
      if (!t) {
        return interaction.reply({ content: "Tidak menemukan data tiket kamu di channel ini.", ephemeral: true });
      }

      // Cek duplikat TXID
      const dup = await Txid.findOne({ guildId: interaction.guild.id, txid: txidVal });
      if (dup) {
        return interaction.reply({ content: "❌ Transaction ID sudah digunakan oleh tiket lain. Harap kirim TXID yang valid.", ephemeral: true });
      }

      // Simpan TXID
      t.txid = txidVal;

      // Assign queue number jika belum ada dan set status paid
      const s = await Settings.findOneAndUpdate(
        { guildId: interaction.guild.id },
        { $inc: { queueCounter: 1 } },
        { upsert: true, new: true }
      );
      if (!t.queueNumber) t.queueNumber = s.queueCounter;
      t.status = "paid";
      await t.save();

      await Txid.create({ guildId: interaction.guild.id, txid: txidVal, ticketId: t._id.toString() });

      const totalPaidOrProcessing = await Ticket.countDocuments({ guildId: interaction.guild.id, status: { $in: ["paid", "processing"] } });
      const pos = await Ticket.countDocuments({ guildId: interaction.guild.id, status: { $in: ["paid", "processing"] }, queueNumber: { $lte: t.queueNumber } });

      await channel.send({
        content: ONDUTY_ROLE_ID ? `<@&${ONDUTY_ROLE_ID}>` : null,
        embeds: [waitingEmbed(pos, totalPaidOrProcessing)],
        components: [staffRow()],
        allowedMentions: { parse: ["roles"] }
      });

      return interaction.reply({ content: "✅ TXID diterima. Kamu masuk ke antrian. Mohon tunggu ya!", ephemeral: true });
    }

  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: "Terjadi error tak terduga. Coba lagi sebentar.", ephemeral: true }); } catch {}
    }
  }
});

// --- Message guard: tolak bukti tanpa TXID ---
client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  if (!msg.channel.name?.startsWith("ticket-")) return;

  const t = await Ticket.findOne({ channelId: msg.channel.id, guildId: msg.guild.id });
  if (!t) return;

  // Kalau status belum paid, dan user kirim gambar/teks tanpa TXID, ingatkan untuk pakai tombol
  if (t.status === "awaiting_txid" && msg.author.id === t.userId) {
    const hasAttachment = msg.attachments.size > 0;
    const mentionsTxid = /txid[:\s]/i.test(msg.content);
    if (hasAttachment || (!mentionsTxid && msg.content.trim().length > 0)) {
      msg.reply({ content: "⚠️ Bukti gambar/teks saja **tidak diterima**. Silakan klik tombol **Submit Transaction ID** di atas.", allowedMentions: { repliedUser: false } }).catch(()=>{});
    }
  }
});

client.login(DISCORD_TOKEN);
