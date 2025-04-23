const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto("https://example.com");

    // Create screenshots directory if not exists
    if (!fs.existsSync("screenshots")) {
      fs.mkdirSync("screenshots");
    }

    await page.screenshot({
      path: "screenshots/example.png",
      fullPage: true,
    });

    console.log("Screenshot saved to screenshots/example.png");
    await browser.close();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
})();
