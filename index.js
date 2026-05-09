require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, ActivityType } = require('discord.js');
const { restoreTimers } = require('./events/avaHandler');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Auto-load all event files
const eventFiles = fs.readdirSync('./events').filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
  const loaded = require(`./events/${file}`);
  const events  = Array.isArray(loaded) ? loaded : [loaded];
  for (const event of events) {
    client.on(event.name, async (...args) => {
      try {
        await event.execute(...args);
      } catch (err) {
        console.error(`❌ Error in event "${event.name}" (${file}):`, err);
      }
    });
  }
}

// Auto-register slash commands on startup
const commands = fs.readdirSync('./commands')
  .filter(f => f.endsWith('.js'))
  .map(f => require(`./commands/${f}`).data.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => { // ← fixed: was 'clientReady'
  console.log(`✅ Logged in as ${client.user.tag}`);
  restoreTimers(client); // reschedules mass + cleanup timers after restart

  // Rotating status
  // const statuses = [
  //   { name: '/help',             type: ActivityType.Playing   },
  //   { name: 'your suggestions',  type: ActivityType.Listening },
  //   { name: 'over the server',   type: ActivityType.Watching  },
  //   { name: 'your tickets',      type: ActivityType.Watching  },
  // ];

  // let i = 0;
  // client.user.setPresence({ activities: [statuses[0]], status: 'online' });

  // setInterval(() => {
  //   i = (i + 1) % statuses.length;
  //   client.user.setPresence({ activities: [statuses[i]], status: 'online' });
  // }, 15000);

  // client.user.setPresence({
  //   activities: [{
  //     name: '/help',
  //     type: ActivityType.Playing,
  //   }],
  //   status: 'online',
  // });

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log(`✅ Slash commands registered`);
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
});

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
});

client.login(process.env.DISCORD_TOKEN);