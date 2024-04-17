export function ellipseAddress(address = ``, width = 6): string {
  return address ? `${address.slice(0, width)}...${address.slice(-width)}` : address
}

export function ellipseAddressJsx(address = ``, width = 6): JSX.Element {
  return address ? (
    <>
      {address.slice(0, width)}&hellip;{address.slice(-width)}
    </>
  ) : (
    <>{address}</>
  )
}
