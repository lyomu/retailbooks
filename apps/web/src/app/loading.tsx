import { Spinner } from '@retailbooks/ui';

export default function Loading() {
  return (
    <div className="rb-standalone">
      <Spinner />
      <span className="rb-visually-hidden">Loading RetailBooks…</span>
    </div>
  );
}
