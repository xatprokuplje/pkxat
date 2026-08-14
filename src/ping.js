import axios from 'axios';

const url = 'https://pkxat.onrender.com';

const pingService = async () => {
  try {
    const response = await axios.get(url);
    console.log(`Ping response: ${response.status}`);
  } catch (error) {
    console.error('Error pinging service:', error.message);
  }
};

// Prvi ping na svakih 5 min (300000 ms)
setInterval(pingService, 300000);

// Drugi ping na svakih 10 min (600000 ms), ali počinje 3 min kasnije
setTimeout(() => {
  setInterval(pingService, 600000);
}, 180000);
