import { ImageResponse } from 'next/og';

export const alt = 'agUSD on Whitechain: a synthetic dollar that earns private credit yield';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraph() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #1F3D31 0%, #254839 45%, #14271F 100%)', padding: 72, color: '#fdf8ed',
        }}
      >
        <div style={{ display: 'flex', fontSize: 30, letterSpacing: 2, opacity: 0.75 }}>AGAMA · WHITECHAIN</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05 }}>A synthetic dollar that earns</div>
          <div style={{ fontSize: 36, marginTop: 24, opacity: 0.8 }}>
            agUSD · one ERC-4626 token · ABF private credit · CCTP V2 to Ethereum
          </div>
        </div>
        <div style={{ display: 'flex', gap: 48, fontSize: 28, opacity: 0.85 }}>
          <span>1s blocks</span><span>OP Stack on Ethereum</span><span>Live on testnet</span>
        </div>
      </div>
    ),
    size,
  );
}
