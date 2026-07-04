"use client";

import type { CSSProperties } from "react";
import { categories } from "@/lib/contract";

export function ProfileSliderPanel({
  values,
  onChange,
  title = "Encrypted Interest Profile",
}: {
  values: number[];
  onChange: (values: number[]) => void;
  title?: string;
}) {
  return (
    <div className="panel">
      <h1>{title}</h1>
      <p className="card-meta">These values are encrypted locally before they touch the contract.</p>
      <div className="form-stack">
        {categories.map((category, index) => (
          <div className="slider-line" key={category}>
            <label htmlFor={`${title}-${category}`}>{category}</label>
            <input
              id={`${title}-${category}`}
              min={0}
              max={100}
              type="range"
              value={values[index]}
              style={{ "--value": `${values[index]}%` } as CSSProperties}
              onChange={(event) => {
                const next = [...values];
                next[index] = Number(event.target.value);
                onChange(next);
              }}
            />
            <input
              aria-label={`${category} value`}
              className="slider-number"
              min={0}
              max={100}
              type="number"
              value={values[index]}
              onChange={(event) => {
                const next = [...values];
                next[index] = Math.max(0, Math.min(100, Number(event.target.value || 0)));
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
