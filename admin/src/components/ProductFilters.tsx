import type { AdminProduct } from '../lib/types';
import type { FlagFilter, ProductFilters } from '../lib/productFilter';
import {
  EMPTY_FILTERS,
  FABRIC_UNSET,
  categoryOptions,
  fabricOptions,
  hasActiveFilters,
} from '../lib/productFilter';

interface Props {
  /** The full catalogue — the select options are derived from it, not from the filtered rows. */
  products: AdminProduct[];
  filters: ProductFilters;
  onChange: (filters: ProductFilters) => void;
  shown: number;
  total: number;
}

export default function ProductFiltersBar({ products, filters, onChange, shown, total }: Props) {
  const set = <K extends keyof ProductFilters>(key: K, value: ProductFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="filter-bar">
      <div className="field">
        <label className="lab" htmlFor="f-category">
          Category
        </label>
        <select
          id="f-category"
          className="inp"
          value={filters.categorySlug}
          onChange={(e) => set('categorySlug', e.target.value)}
        >
          <option value="">Any</option>
          {categoryOptions(products).map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="lab" htmlFor="f-fabric">
          Fabric
        </label>
        <select
          id="f-fabric"
          className="inp"
          value={filters.fabric}
          onChange={(e) => set('fabric', e.target.value)}
        >
          <option value="">Any</option>
          {fabricOptions(products).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value={FABRIC_UNSET}>Not recorded</option>
        </select>
      </div>

      <div className="field">
        <label className="lab" htmlFor="f-flag">
          Flag
        </label>
        <select
          id="f-flag"
          className="inp"
          value={filters.flag}
          onChange={(e) => set('flag', e.target.value as FlagFilter)}
        >
          <option value="">Any</option>
          <option value="sale">Sale</option>
          <option value="new">New</option>
          <option value="bestseller">Bestseller</option>
          <option value="none">No flag</option>
        </select>
      </div>

      <div className="field">
        <label className="lab" htmlFor="f-visibility">
          Visibility
        </label>
        <select
          id="f-visibility"
          className="inp"
          value={filters.visibility}
          onChange={(e) => set('visibility', e.target.value as ProductFilters['visibility'])}
        >
          <option value="">Any</option>
          <option value="active">Active</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>

      <div className="field narrow">
        <label className="lab" htmlFor="f-min">
          Min ₹
        </label>
        <input
          id="f-min"
          className="inp"
          type="number"
          min="0"
          inputMode="numeric"
          value={filters.minRupees}
          onChange={(e) => set('minRupees', e.target.value)}
        />
      </div>

      <div className="field narrow">
        <label className="lab" htmlFor="f-max">
          Max ₹
        </label>
        <input
          id="f-max"
          className="inp"
          type="number"
          min="0"
          inputMode="numeric"
          value={filters.maxRupees}
          onChange={(e) => set('maxRupees', e.target.value)}
        />
      </div>

      <div className="filter-tail">
        <span className="dim">
          Showing {shown} of {total} pieces
        </span>
        {hasActiveFilters(filters) && (
          <button className="btn-outline fit" type="button" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
