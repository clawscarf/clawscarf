import ipaddr from "ipaddr.js";
import definition from "../../deploy/execution/network/public-addresses.json" with { type: "json" };

type Subnet = ReturnType<typeof ipaddr.parseCIDR>;

/** Split only ranges containing an exclusion; no address enumeration. */
function subtract(subnet: Subnet, excluded: Subnet): Subnet[] {
  const [address, prefix] = subnet;
  const [blocked, blockedPrefix] = excluded;
  if (address.kind() !== blocked.kind()) return [subnet];
  if (prefix >= blockedPrefix)
    return address.match(blocked, blockedPrefix) ? [] : [subnet];
  if (!blocked.match(address, prefix)) return [subnet];
  const bytes = address.toByteArray();
  const index = Math.floor(prefix / 8);
  bytes[index] = (bytes[index] ?? 0) | (1 << (7 - (prefix % 8)));
  return [
    ...subtract([address, prefix + 1], excluded),
    ...subtract([ipaddr.fromByteArray(bytes), prefix + 1], excluded),
  ];
}

export const publicWebAddresses = definition.excluded
  .reduce<Subnet[]>(
    (ranges, excluded) =>
      ranges.flatMap((range) => subtract(range, ipaddr.parseCIDR(excluded))),
    definition.families.map((cidr) => ipaddr.parseCIDR(cidr)),
  )
  .map(([address, prefix]) => `${address.toString()}/${String(prefix)}`);

export function isPublicAddress(value: string) {
  const address = ipaddr.parse(value);
  return publicWebAddresses.some((cidr) => {
    const [network, prefix] = ipaddr.parseCIDR(cidr);
    return address.kind() === network.kind() && address.match(network, prefix);
  });
}
