/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@wayfarer/core'],
  webpack: (config) => {
    // Resolve .js imports to .ts sources in transpiled monorepo packages
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    }
    return config
  },
}

export default nextConfig
