import { Dispatch, SetStateAction, useEffect, useState } from "react";

export const useLocalStorage = <T,>(
  key: string,
  initialValue: T,
  parse: (raw: string) => T,
  serialize: (value: T) => string = JSON.stringify
): [T, Dispatch<SetStateAction<T>>] => {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        return initialValue;
      }
      return parse(raw);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, serialize(value));
    } catch {
      // Ignore storage write errors.
    }
  }, [key, serialize, value]);

  return [value, setValue];
};
