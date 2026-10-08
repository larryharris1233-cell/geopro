import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, shared, spacing } from '@/constants/theme';
import weighStationsJson from '@/data/weighStations.json';
import type { WeighStation } from '@/data/types';

const stations = weighStationsJson as WeighStation[];

type Filter = 'all' | 'open' | 'closed';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];

export default function WeighScreen() {
  // v1: status lives in local state only. v2 will sync with crowdsourced reports.
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>('all');

  const isOpen = (id: string) => status[id] ?? true;

  const visible = useMemo(() => {
    if (filter === 'all') return stations;
    return stations.filter((s) => (filter === 'open' ? isOpen(s.id) : !isOpen(s.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, status]);

  const openCount = stations.filter((s) => isOpen(s.id)).length;

  const toggle = (id: string) =>
    setStatus((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));

  const renderStation = ({ item }: { item: WeighStation }) => {
    const open = isOpen(item.id);
    return (
      <View style={[shared.card, styles.card]}>
        <View style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.detail}>
              {item.interstate} · {item.mileMarker} · {item.state}
            </Text>
          </View>
          <View style={[styles.pill, open ? styles.pillOpen : styles.pillClosed]}>
            <Text style={[styles.pillText, open ? styles.pillTextOpen : styles.pillTextClosed]}>
              {open ? 'OPEN' : 'CLOSED'}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => toggle(item.id)}
          accessibilityRole="switch"
          accessibilityState={{ checked: open }}
          accessibilityLabel={`Mark ${item.name} as ${open ? 'closed' : 'open'}`}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
          <Text style={styles.toggleText}>
            Mark as {open ? 'closed' : 'open'}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={shared.screen}>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderStation}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <Text style={styles.count}>
              {openCount} of {stations.length} stations reporting open
            </Text>
            <View style={styles.filterRow}>
              {FILTERS.map((f) => (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === f.key }}
                  style={[
                    styles.filterChip,
                    filter === f.key && styles.filterChipActive,
                  ]}>
                  <Text
                    style={[
                      styles.filterText,
                      filter === f.key && styles.filterTextActive,
                    ]}>
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No stations in this view</Text>
            <Text style={styles.emptyText}>Try a different filter.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.md,
  },
  count: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  filterTextActive: {
    color: '#14100A',
  },
  card: {
    marginBottom: spacing.md,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  info: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  detail: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 2,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillOpen: {
    backgroundColor: '#0E2E22',
  },
  pillClosed: {
    backgroundColor: '#331414',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '800',
  },
  pillTextOpen: {
    color: colors.success,
  },
  pillTextClosed: {
    color: colors.danger,
  },
  toggle: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 56,
  },
  toggleText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
  empty: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.xs,
  },
});
