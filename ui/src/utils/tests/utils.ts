/**
 * Creates an array containing unique values followed by duplicates of a default value.
 *
 * @template T The type of the elements in the array.
 * @param {T[]} values - An array of unique values to start the array.
 * @param {T} defaultValue - The default value to fill the rest of the array.
 * @param {number} length - The total desired length of the array.
 * @returns {T[]} - An array of elements of type T.
 */
export function createStaticArray<T>(values: T[], defaultValue: T, length: number): T[] {
  const resultArray: T[] = [...values]

  // Calculate the remaining number of default values needed
  const remainingSlots = length - values.length

  // Fill the rest of the array with the default value
  for (let i = 0; i < remainingSlots; i++) {
    resultArray.push(defaultValue)
  }

  return resultArray
}

/**
 * Parses a box name string into encoding and value, decoding if necessary.
 * @param {string} nameParam - The name parameter in the format 'encoding:value'.
 * @returns {[string, string]} - A tuple containing the encoding and the (possibly decoded) value.
 */
export function parseBoxName(nameParam: string): [string, string] {
  const [encoding, value] = nameParam.split(':', 2)

  if (encoding === 'b64' && value) {
    // Decode base64 string to a readable format
    const decodedValue = Buffer.from(value, 'base64').toString('utf-8')
    return [encoding, decodedValue]
  }

  return [encoding, value]
}
