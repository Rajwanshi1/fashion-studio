import { formatINR } from '../lib/format';

/** Inline INR price (money in integer paise). */
export default function Price({ paise }: { paise: number }) {
  return <>{formatINR(paise)}</>;
}
