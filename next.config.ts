import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Immagine Docker con il solo server necessario (FON-T06).
  output: 'standalone',
  // `next dev` non scrive AGENTS.md: istruzioni per gli agenti che nessun hook controlla (FON-T01).
  agentRules: false,
};

export default nextConfig;
