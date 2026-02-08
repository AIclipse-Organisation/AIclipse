/** @type {import('next').NextConfig} */
module.exports = {
  basePath: "/community",
  output: "standalone",
  logging: {
    incomingRequests: {
      ignore: [/^\/healthz$/, /^\/api\/healthz$/],
    },
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '1gb',
    },
  },
};
