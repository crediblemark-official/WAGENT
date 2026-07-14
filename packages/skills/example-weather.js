// Example Weather Skill for WAGENT
// Exports a default factory function returning a SkillDefinition
// USAGE: Install with `wagent skill install ./packages/skills/example-weather.js`

/**
 * @param {string} city
 * @returns {Promise<string>}
 */
async function getWeather(city) {
  // In production, call a real weather API like:
  // const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=YOUR_KEY`)
  // For now, return mock data
  const weatherData = {
    'Jakarta': { temp: 32, condition: 'Cerah berawan', humidity: 78 },
    'Bandung': { temp: 24, condition: 'Berawan', humidity: 85 },
    'Surabaya': { temp: 33, condition: 'Cerah', humidity: 65 },
    'Bali': { temp: 30, condition: 'Cerah', humidity: 70 },
    'default': { temp: 28, condition: 'Cerah', humidity: 72 },
  };

  const data = weatherData[city] || weatherData['default'];
  return JSON.stringify({
    city,
    temperature: `${data.temp}°C`,
    condition: data.condition,
    humidity: `${data.humidity}%`,
  });
}

/**
 * @returns {import('@wagent/core').SkillDefinition}
 */
export default function createWeatherSkill() {
  return {
    manifest: {
      name: 'weather',
      version: '1.0.0',
      description: 'Cek cuaca terkini untuk berbagai kota di Indonesia',
      author: 'WAGENT Team',
    },
    tools: [
      {
        name: 'get_weather',
        description: 'Dapatkan informasi cuaca untuk suatu kota di Indonesia',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'Nama kota (contoh: Jakarta, Bandung, Surabaya)',
            },
          },
          required: ['city'],
        },
        handler: async (args, context) => {
          const city = String(args.city);
          context.logger.info({ city }, 'Weather skill: checking weather for %s', city);
          return getWeather(city);
        },
      },
    ],
  };
}
