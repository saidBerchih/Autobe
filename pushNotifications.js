// const axios = require('axios');
import axios from "axios";

// Get these from:
// 1. Expo push token (from your app users)
// 2. Expo access token (from expo.dev/settings/access-tokens)
const EXPO_PUSH_TOKEN = process.env.EXPO_PUSH_TOKEN;
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN;

async function sendPushNotification() {
  try {
    const response = await axios.post(
      "https://exp.host/--/api/v2/push/send",
      {
        to: EXPO_PUSH_TOKEN,
        title: "GitHub Action Alert",
        body: "Your workflow completed successfully!",
        data: { url: "https://github.com" }, // Optional deep link
      },
      {
        headers: {
          Authorization: `Bearer ${EXPO_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Notification sent:", response.data);
  } catch (error) {
    console.error(
      "Failed to send notification:",
      error.response?.data || error.message
    );
    process.exit(1);
  }
}
