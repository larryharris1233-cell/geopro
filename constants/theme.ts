import { StyleSheet } from 'react-native';

export const colors = {
  background: '#0B0E14',
  surface: '#141924',
  surface2: '#1C2331',
  border: '#2A3346',
  text: '#F2F4F8',
  muted: '#9AA3B2',
  primary: '#F5A623', // diesel amber
  primaryDim: '#7A5410',
  success: '#34D399',
  danger: '#F87171',
  info: '#60A5FA',
  // Chain brand colors for map pins
  chain: {
    Pilot: '#E5484D',
    "Love's": '#F5A623',
    'Flying J': '#34D399',
    TA: '#60A5FA',
    Petro: '#F97316',
  } as Record<string, string>,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const shared = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  touchable: {
    minHeight: 56,
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: '#14100A',
    fontSize: 17,
    fontWeight: '800',
  },
  searchInput: {
    backgroundColor: colors.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 17,
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
});
