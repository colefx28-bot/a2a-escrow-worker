export type RelayerRequest =
  | {
      fn: 'fundAndSettle';
      params: {
        dealId: `0x${string}`;
        payer: `0x${string}`;
        payee: `0x${string}`;
        amount: string;
        validAfter: string;
        validBefore: string;
        nonce: `0x${string}`;
        v: number;
        r: `0x${string}`;
        s: `0x${string}`;
      };
    }
  | {
      fn: 'fund';
      params: {
        dealId: `0x${string}`;
        payer: `0x${string}`;
        payee: `0x${string}`;
        amount: string;
        expiry: string;
        validAfter: string;
        validBefore: string;
        nonce: `0x${string}`;
        v: number;
        r: `0x${string}`;
        s: `0x${string}`;
      };
    }
  | {
      fn: 'release';
      params: { dealId: `0x${string}` };
    }
  | {
      fn: 'refund';
      params: { dealId: `0x${string}` };
    };
