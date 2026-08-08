import { useEffect, useMemo, useState } from 'react';
import { API_URL, api, storedToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { useListSearch } from '../lib/pageChrome';
import type { AdminUser, Role } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import ListSearch from '../components/shell/ListSearch';
import { Skeleton } from '../components/ui';
import { useToast } from '../components/Toast';

const SEARCH_PLACEHOLDER = 'Search customers…';

const fullName = (u: AdminUser) => `${u.firstName} ${u.lastName}`.trim();

/**
 * Name, email or phone. Phones match on digits only, so a typed '98765' finds
 * '+91 98765…' however the number happens to be punctuated.
 */
function matchesQuery(u: AdminUser, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (fullName(u).toLowerCase().includes(needle)) return true;
  if (u.email?.toLowerCase().includes(needle)) return true;
  const digits = needle.replace(/\D/g, '');
  return digits.length > 0 && (u.phone ?? '').replace(/\D/g, '').includes(digits);
}

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [query] = useListSearch(SEARCH_PLACEHOLDER);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<AdminUser[]>('/api/admin/users')
      .then((data) => live && setUsers(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  const changeRole = async (user: AdminUser, role: Role) => {
    const previous = users;
    setUsers((cur) => (cur ? cur.map((u) => (u.id === user.id ? { ...u, role } : u)) : cur));
    try {
      const updated = await api<AdminUser>(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: { role },
      });
      setUsers((cur) => (cur ? cur.map((u) => (u.id === user.id ? updated : u)) : cur));
      toast(`${user.email ?? user.phone ?? fullName(user)} is now ${role === 'admin' ? 'an admin' : 'a customer'}`);
    } catch (err) {
      setUsers(previous ?? null);
      toast(err instanceof Error ? err.message : 'Unable to update role', { tone: 'error' });
    }
  };

  // Bypasses the JSON client deliberately: the response is a file download.
  // On iPhone Safari the .vcf hands straight off to the Contacts app.
  const exportContacts = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/customers.vcf`, {
        headers: { Authorization: `Bearer ${storedToken() ?? ''}` },
      });
      if (!res.ok) throw new Error('Unable to export contacts');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ta-customers.vcf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to export contacts', { tone: 'error' });
    }
  };

  const rows = useMemo(
    () => (users ?? []).filter((u) => matchesQuery(u, query)),
    [users, query],
  );

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (u) =>
        fullName(u) ? <span className="nm">{fullName(u)}</span> : <span className="dim">—</span>,
    },
    {
      key: 'email',
      label: 'Email',
      render: (u) => u.email ?? <span className="dim">—</span>,
    },
    {
      key: 'phone',
      label: 'Phone',
      render: (u) => u.phone ?? <span className="dim">—</span>,
    },
    {
      key: 'provider',
      label: 'Provider',
      render: (u) => <span className="badge muted">{u.authProvider}</span>,
    },
    {
      key: 'role',
      label: 'Role',
      render: (u) =>
        u.role === 'admin' ? (
          <span className="badge crafting">Admin</span>
        ) : (
          <span className="badge pending">Customer</span>
        ),
    },
    { key: 'orders', label: 'Orders', align: 'right', render: (u) => u.ordersCount },
    { key: 'joined', label: 'Joined', render: (u) => formatDate(u.createdAt) },
    {
      key: 'action',
      label: 'Access',
      render: (u) => {
        const self = me?.id === u.id;
        const next: Role = u.role === 'admin' ? 'customer' : 'admin';
        return (
          <button
            type="button"
            className="ulink"
            disabled={self}
            title={self ? 'You cannot change your own role' : undefined}
            onClick={() => void changeRole(u, next)}
          >
            {next === 'admin' ? 'Make admin' : 'Make customer'}
          </button>
        );
      },
    },
  ];

  return (
    <>
      <div className="head-row">
        <div className="page-head-admin">
          <span className="eyebrow">The House · Customers</span>
          <h1>Customers</h1>
        </div>
        <div className="head-tools">
          <ListSearch placeholder={SEARCH_PLACEHOLDER} />
          <button type="button" className="ulink vcf-export" onClick={() => void exportContacts()}>
            Export contacts (.vcf)
          </button>
        </div>
      </div>

      {error && <p className="state-note">{error}</p>}
      {!users && !error && <Skeleton variant="rows" />}
      {users && (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          empty={
            query.trim() ? 'No customers match that search.' : 'No customers registered yet.'
          }
        />
      )}
    </>
  );
}
