const express = require("express");
const serverless = require("serverless-http");
const { Probot, createNodeMiddleware } = require("probot");
const appFn = require("./app");

const probot = new Probot({
  appId: process.env.APP_ID,
  privateKey: process.env.PRIVATE_KEY,
  secret: process.env.WEBHOOK_SECRET
});

const app = express();
app.use(createNodeMiddleware(appFn, { probot }));
app.get("/healthz", (_, res) => res.send("OK"));

module.exports.handler = serverless(app);
