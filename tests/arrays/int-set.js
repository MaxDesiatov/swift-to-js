export function arraySet$array$index$value$(array, index, value) {
  (function () {
    if (index >= array.length || index < 0) throw new RangeError("Array index out of range");
    return array[index] = value;
  })();
}