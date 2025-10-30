require("dotenv").config();
const {
  Client, GatewayIntentBits, Partials,
  PermissionsBitField, ChannelType, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder, REST, Routes, PermissionFlagsBits
} = require("discord.js");
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

// Supabase init
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const {
  DISCORD_TOKEN, CLIENT_ID, GUILD_ID,
  QRIS_URL, PAYPAL_URL,
  STAFF_ROLE_ID, ONDUTY_ROLE_ID
} = process.env;

// Keep alive (Replit)
const app = express();
app.get("/", (_, res) => res.send("LimeHub Ticket Bot alive"));
app.listen(3000, () => console.log("Keep-alive web running"));

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

// Commands
const commands = [
  new SlashCommandBuilder().setName("setup").setDescription("Pasang panel tiket").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("close").setDescription("Tutup tiket").setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName("status").setDescription("Ubah status tiket").addStringOption(o=>o.setName("to").setDescription("paid/processing").setRequired(true).addChoices({name:"paid",value:"paid"},{name:"processing",value:"processing"})).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName("on").setDescription("Set kamu on-duty"),
  new SlashCommandBuilder().setName("off").setDescription("Set kamu off-duty"),
].map(c=>c.toJSON());

async function registerCommands(){
  const rest=new REST({version:"10"}).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
  console.log("Slash commands registered.");
}

// Embeds
function ticketIntroEmbed(){
  return new EmbedBuilder()
    .setTitle("Payment Instructions")
    .setDescription(`Silakan lakukan pembayaran:\n• QRIS: ${QRIS_URL}\n• PayPal: ${PAYPAL_URL}\n\nSetelah bayar WAJIB kirim Transaction ID pakai tombol.`)
    .setFooter({ text:"made by @unstoppable_neid" });
}
function waitingEmbed(pos,total){
  return new EmbedBuilder()
    .setTitle("Proses!")
    .setDescription("__Please wait, your ticket will be processed according to the queue order.__\nMohon bersabar, tiket anda akan kami kerjakan sesuai urutan.")
    .addFields({name:"Queue",value:`#${pos} dari ${total}`,inline:true},{name:"Status",value:"Paid ✅",inline:true})
    .setFooter({ text:"made by @unstoppable_neid"});
}

// Helpers
async function getOnDutyList(guildId){
  const { data } = await supabase.from("onduty").select("user_id").eq("guild_id",guildId);
  if(!data || !data.length) return "❌ Tidak ada staff on-duty";
  return data.map(d=>`<@${d.user_id}>`).join(", ");
}

async function composeStatusEmbed(guildId,ticket){
  const mods=await getOnDutyList(guildId);
  const { data: totalData }=await supabase.from("tickets").select("id").eq("guild_id",guildId).in("status",["paid","processing"]);
  const total=totalData?.length||0;
  let pos="-";
  if(ticket.queue_number){
    const { data: posData }=await supabase.from("tickets").select("id").eq("guild_id",guildId).in("status",["paid","processing"]).lte("queue_number",ticket.queue_number);
    pos=posData?.length||1;
  }
  return new EmbedBuilder().setTitle("LimeHub — Ticket Status").setDescription(`**Moderator On-Duty**\n${mods}\n\n**Antrian**\nPosisi: #${pos} dari ${total}`).setFooter({ text:"made by @unstoppable_neid"});
}

// Ready
client.once("ready",async()=>{
  console.log(`${client.user.tag} online`);
  await registerCommands();
});

// Interactions
client.on("interactionCreate",async(interaction)=>{
  try{
    if(interaction.isChatInputCommand()){
      if(interaction.commandName==="setup"){
        await supabase.from("settings").upsert({guild_id:interaction.guild.id,panel_channel_id:interaction.channel.id});
        const embed=new EmbedBuilder().setTitle("LimeHub — Ticket Panel").setDescription("Klik tombol di bawah untuk membuat tiket pembelian script.\nBot akan memberi instruksi bayar + antrian realtime.").setFooter({ text:"made by @unstoppable_neid"});
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("create_ticket").setLabel("Create Ticket").setStyle(ButtonStyle.Success));
        await interaction.channel.send({embeds:[embed],components:[row]});
        return interaction.reply({content:"Panel tiket dipasang ✅",ephemeral:true});
      }
      if(interaction.commandName==="on"){
        if(!interaction.member.roles.cache.has(String(STAFF_ROLE_ID))) return interaction.reply({content:"Buat staff aja",ephemeral:true});
        await supabase.from("onduty").upsert({guild_id:interaction.guild.id,user_id:interaction.user.id});
        return interaction.reply({content:"Kamu sekarang **ON-DUTY** ✅",ephemeral:true});
      }
      if(interaction.commandName==="off"){
        if(!interaction.member.roles.cache.has(String(STAFF_ROLE_ID))) return interaction.reply({content:"Buat staff aja",ephemeral:true});
        await supabase.from("onduty").delete().eq("guild_id",interaction.guild.id).eq("user_id",interaction.user.id);
        return interaction.reply({content:"Kamu sekarang **OFF-DUTY** 📴",ephemeral:true});
      }
    }

    if(interaction.isButton()){
      if(interaction.customId==="create_ticket"){
        const name=`ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g,"");
        const chan=await interaction.guild.channels.create({
          name,
          type:ChannelType.GuildText,
          permissionOverwrites:[
            {id:interaction.guild.id, deny:[PermissionsBitField.Flags.ViewChannel]},
            {id:interaction.user.id, allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]},
            {id:String(STAFF_ROLE_ID), allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]}
          ]
        });
        const { data: t }=await supabase.from("tickets").insert({guild_id:interaction.guild.id,channel_id:chan.id,user_id:interaction.user.id,status:"awaiting_txid"}).select().single();
        await chan.send({content:`<@${interaction.user.id}> selamat datang di tiket pembelian script.`,embeds:[ticketIntroEmbed()],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("submit_txid").setLabel("Submit Transaction ID").setStyle(ButtonStyle.Primary))]});
        const embed=await composeStatusEmbed(interaction.guild.id,t);
        await chan.send({embeds:[embed]});
        return interaction.reply({content:`Tiket dibuat: ${chan}`,ephemeral:true});
      }
    }
  }catch(e){ console.error(e); }
});

client.login(DISCORD_TOKEN);
