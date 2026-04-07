/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/community",
  output: "standalone",
  logging: {
    incomingRequests: {
      ignore: [/^\/healthz$/, /^\/api\/healthz$/],
    },
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },

  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 500,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;
