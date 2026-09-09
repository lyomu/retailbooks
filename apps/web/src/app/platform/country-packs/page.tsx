import type { Metadata } from 'next';

import { PlatformCountryPacks } from '../../../components/platform-country-packs';

export const metadata: Metadata = { title: 'Country and tax | RetailBooks platform' };

export default function PlatformCountryPacksRoute() {
  return <PlatformCountryPacks />;
}
