/** @type {import('next').NextConfig} */
module.exports = {
  basePath: "/community",
  logging: {
    incomingRequests: {
      ignore: [/^\/healthz$/, /^\/api\/healthz$/],
    },
  }
};