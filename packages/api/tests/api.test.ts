import { DEVNET_URL, HIRO_MAINNET_URL, HIRO_TESTNET_URL } from '@stacks/common';
import { FUNAI_DEVNET, FUNAI_MAINNET, FUNAI_TESTNET } from '@stacks/network';
import { FunaiNodeApi } from '../src';

describe('setting FunaiApi URL', () => {
  test.each([
    { network: FUNAI_MAINNET, url: HIRO_MAINNET_URL },
    { network: FUNAI_TESTNET, url: HIRO_TESTNET_URL },
    { network: FUNAI_DEVNET, url: DEVNET_URL },
  ])('the api class determines the correct url for each network object', ({ network, url }) => {
    const api = new FunaiNodeApi({ network });
    expect(api.baseUrl).toEqual(url);
  });
});
