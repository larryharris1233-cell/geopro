import Slider from '@react-native-community/slider';
import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  loadNavOptions,
  ROUTE_COLORS,
  saveNavOptions,
  TRUCK_MAKES,
  type NavOptions,
} from '@/constants/navOptions';
import { clearHome, loadHome, type HomePlace } from '@/constants/home';
import { colors, shared, spacing } from '@/constants/theme';
import {
  loadTripLog,
  stateName,
  tripToCsv,
  type TripRecord,
} from '@/constants/tripLog';

const ROADMAP = [
  {
    title: 'User accounts + crowdsourced reports',
    detail: 'Sign in, then report weigh station status, parking availability, and shower wait times for other drivers in real time.',
  },
  {
    title: 'Live fuel prices (EIA API)',
    detail: 'Pull the weekly EIA diesel series with a free api.eia.gov key, plus per-station pump prices where available.',
  },
  {
    title: 'Real-time parking availability',
    detail: 'Crowdsourced + partner lot-sensor data so you know before you exit whether there is a spot.',
  },
  {
    title: 'ELD / Hours of Service',
    detail: 'Duty-status logging, 11/14/70-hour clocks, and break reminders built for the cab.',
  },
  {
    title: 'Hammer Lane Co subscription',
    detail: 'Free core app; paid tier unlocks offline maps and ad-free fuel tracking.',
  },
];

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

function TripTable({
  trip,
  onExport,
}: {
  trip: TripRecord;
  onExport?: () => void;
}) {
  const rows = Object.entries(trip.stateMiles)
    .filter(([, mi]) => mi > 0.05)
    .sort((a, b) => b[1] - a[1]);
  return (
    <View>
      <View style={styles.tripHeaderRow}>
        <Text style={styles.tripDate}>
          {trip.endedAt
            ? `${fmtDate(trip.startedAt)} · completed`
            : `Started ${fmtDate(trip.startedAt)} · in progress`}
        </Text>
        <Text style={styles.tripTotal}>{trip.totalMiles.toFixed(1)} mi</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.tripEmpty}>
          No miles logged yet — miles appear here as you drive.
        </Text>
      ) : (
        rows.map(([abbr, mi]) => (
          <View key={abbr} style={styles.tripRow}>
            <Text style={styles.tripState}>
              {abbr === '??' ? 'Unknown' : `${stateName(abbr)} (${abbr})`}
            </Text>
            <Text style={styles.tripMiles}>{mi.toFixed(1)} mi</Text>
          </View>
        ))
      )}
      {onExport ? (
        <Pressable
          onPress={onExport}
          accessibilityRole="button"
          accessibilityLabel="Export this trip as a CSV file for IFTA"
          style={({ pressed }) => [styles.exportButton, pressed && styles.pressed]}>
          <Text style={styles.exportButtonText}>Export CSV (IFTA)</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function MoreScreen() {
  const [options, setOptions] = useState<NavOptions | null>(null);
  const [voiceChoices, setVoiceChoices] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [currentTrip, setCurrentTrip] = useState<TripRecord | null>(null);
  const [pastTrips, setPastTrips] = useState<TripRecord[]>([]);
  // Build #21: the saved home for the "Route home" shortcut —
  // set from a place card on the Map, shown/cleared here. Stored
  // on-device only.
  const [homePlace, setHomePlace] = useState<HomePlace | null>(null);

  const refresh = useCallback(() => {
    loadNavOptions().then(setOptions);
    loadTripLog().then((log) => {
      setCurrentTrip(log.current);
      setPastTrips(log.history);
    });
    loadHome().then(setHomePlace);
  }, []);

  async function exportTrip(trip: TripRecord) {
    try {
      await Share.share({
        title: `Hammer Lane Co IFTA trip ${fmtDate(trip.startedAt)}`,
        message: tripToCsv(trip),
      });
    } catch {}
  }

  useEffect(() => {
    refresh();
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        const en = voices.filter((v) =>
          (v.language || '').toLowerCase().startsWith('en'),
        );
        const pool = en.length ? en : voices;
        setVoiceChoices(
          pool
            .slice(0, 3)
            .map((v, i) => ({ id: v.identifier, label: `Voice ${i + 1}` })),
        );
      })
      .catch(() => {});
  }, [refresh]);

  useFocusEffect(refresh);

  function update(patch: Partial<NavOptions>) {
    if (!options) return;
    const next = { ...options, ...patch };
    setOptions(next);
    void saveNavOptions(next);
  }

  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      <View style={[shared.card, styles.about]}>
        <Text style={styles.appName}>Hammer Lane Co</Text>
        <Text style={styles.version}>v1.0.0 · built for drivers</Text>
        <Text style={styles.blurb}>
          The state-of-the-art trucker companion for US highways: truck stops,
          diesel prices, and weigh stations — dark, glove-friendly, and fast.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Home</Text>
      <View style={[shared.card, styles.settingsCard]}>
        {homePlace ? (
          <>
            <View style={styles.row}>
              <Text style={styles.settingLabel}>Saved home</Text>
            </View>
            <Text style={styles.blurb}>{homePlace.name ?? 'Dropped pin'}</Text>
            <View style={styles.row}>
              <Pressable
                onPress={() => {
                  void clearHome();
                  setHomePlace(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear the saved home"
                style={styles.pill}>
                <Text style={styles.pillText}>Clear home</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={styles.blurb}>
            No home set yet. Search your home address on the Map, open its
            card, and tap “Set as home”. It stays on this phone — then
            long-press the app icon to place the “Route home” button on
            your home screen.
          </Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Navigation</Text>
      <View style={[shared.card, styles.settingsCard]}>
        {options ? (
          <>
            <View style={styles.row}>
              <Text style={styles.settingLabel}>Voice</Text>
              <Pressable
                onPress={() => update({ voice: !options.voice })}
                accessibilityRole="button"
                accessibilityLabel="Toggle voice guidance"
                style={[styles.pill, options.voice && styles.pillOn]}>
                <Text
                  style={[styles.pillText, options.voice && styles.pillTextOn]}>
                  {options.voice ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
              {voiceChoices.map((choice) => (
                <Pressable
                  key={choice.id}
                  onPress={() => {
                    update({ voice: true, voiceId: choice.id });
                    try {
                      Speech.stop();
                      Speech.speak('Turn left onto Main Street.', {
                        voice: choice.id,
                        volume: options.voiceVolume,
                      });
                    } catch {}
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${choice.label} and hear a sample`}
                  style={[
                    styles.pill,
                    options.voiceId === choice.id && styles.pillOn,
                  ]}>
                  <Text
                    style={[
                      styles.pillText,
                      options.voiceId === choice.id && styles.pillTextOn,
                    ]}>
                    {choice.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Build #27 (item 10b): the voice-volume slider —
                Larry turns the prompt voice up or down in the
                app, independent of the phone's media volume.
                Releasing the slider speaks a sample at the new
                level so he hears exactly what he set. */}
            <View style={styles.row}>
              <Text style={styles.settingLabel}>Voice volume</Text>
              <Text style={styles.volumePct}>
                {Math.round(options.voiceVolume * 100)}%
              </Text>
            </View>
            <Slider
              style={styles.volumeSlider}
              value={options.voiceVolume}
              minimumValue={0.1}
              maximumValue={1}
              step={0.05}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
              accessibilityLabel="Voice prompt volume"
              onValueChange={(v) => update({ voiceVolume: v })}
              onSlidingComplete={(v) => {
                if (!options.voice) return;
                try {
                  Speech.stop();
                  Speech.speak('Voice volume.', {
                    voice: options.voiceId ?? undefined,
                    volume: v,
                  });
                } catch {}
              }}
            />

            <View style={styles.row}>
              <Text style={styles.settingLabel}>Auto reroute</Text>
              <Pressable
                onPress={() => update({ reroute: !options.reroute })}
                accessibilityRole="button"
                accessibilityLabel="Toggle automatic rerouting"
                style={[styles.pill, options.reroute && styles.pillOn]}>
                <Text
                  style={[styles.pillText, options.reroute && styles.pillTextOn]}>
                  {options.reroute ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              <Text style={styles.settingLabel}>Zoom on turns</Text>
              <Pressable
                onPress={() => update({ zoom: !options.zoom })}
                accessibilityRole="button"
                accessibilityLabel="Toggle zooming in on turns"
                style={[styles.pill, options.zoom && styles.pillOn]}>
                <Text style={[styles.pillText, options.zoom && styles.pillTextOn]}>
                  {options.zoom ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              <Text style={styles.settingLabel}>Weather + storm alerts</Text>
              <Pressable
                onPress={() => update({ weather: !options.weather })}
                accessibilityRole="button"
                accessibilityLabel="Toggle weather conditions and severe weather voice alerts"
                style={[styles.pill, options.weather && styles.pillOn]}>
                <Text style={[styles.pillText, options.weather && styles.pillTextOn]}>
                  {options.weather ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              <Text style={styles.settingLabel}>Weather radar on map</Text>
              <Pressable
                onPress={() => update({ radar: !options.radar })}
                accessibilityRole="button"
                accessibilityLabel="Toggle the weather radar overlay on the map"
                style={[styles.pill, options.radar && styles.pillOn]}>
                <Text style={[styles.pillText, options.radar && styles.pillTextOn]}>
                  {options.radar ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              <Text style={styles.settingLabel}>Hazard reports + alerts</Text>
              <Pressable
                onPress={() => update({ hazards: !options.hazards })}
                accessibilityRole="button"
                accessibilityLabel="Toggle road hazard reports and spoken reported-ahead alerts"
                style={[styles.pill, options.hazards && styles.pillOn]}>
                <Text style={[styles.pillText, options.hazards && styles.pillTextOn]}>
                  {options.hazards ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              <Text style={styles.settingLabel}>Speeding alert (5 over)</Text>
              <Pressable
                onPress={() => update({ speedAlert: !options.speedAlert })}
                accessibilityRole="button"
                accessibilityLabel="Toggle the spoken alert when driving 5 or more over the speed limit"
                style={[styles.pill, options.speedAlert && styles.pillOn]}>
                <Text style={[styles.pillText, options.speedAlert && styles.pillTextOn]}>
                  {options.speedAlert ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              <Text style={styles.settingLabel}>Route color</Text>
              {ROUTE_COLORS.map((c) => (
                <Pressable
                  key={c.hex}
                  onPress={() => update({ routeColor: c.hex })}
                  accessibilityRole="button"
                  accessibilityLabel={`Route line color ${c.label}`}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c.hex },
                    options.routeColor === c.hex && styles.colorDotOn,
                  ]}
                />
              ))}
            </View>

            <Text style={[styles.settingLabel, styles.truckLabel]}>My truck</Text>
            <View style={styles.truckRow}>
              {TRUCK_MAKES.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => update({ truckMake: t.key })}
                  accessibilityRole="button"
                  accessibilityLabel={`My truck: ${t.label}`}
                  style={[
                    styles.truckChoice,
                    options.truckMake === t.key && styles.truckChoiceOn,
                  ]}>
                  <Image
                    source={t.image}
                    style={styles.truckPhoto}
                    resizeMode="contain"
                  />
                  <Text
                    style={[
                      styles.truckChoiceText,
                      options.truckMake === t.key && styles.truckChoiceTextOn,
                    ]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.settingLabel}>Loading settings…</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>IFTA / Trip Log</Text>
      <View style={[shared.card, styles.settingsCard]}>
        {currentTrip ? (
          <>
            <Text style={styles.tripStatus}>
              Trip running — logging miles by state. Start or stop it from
              the “Start trip” button on the Map tab.
            </Text>
            <TripTable
              trip={currentTrip}
              onExport={() => void exportTrip(currentTrip)}
            />
          </>
        ) : (
          <Text style={styles.tripStatus}>
            No trip running. Tap “Start trip” on the Map tab before you roll
            and Hammer Lane Co logs your miles state by state for IFTA — offline, on
            this phone only.
          </Text>
        )}
        {pastTrips.length > 0 ? (
          <>
            <Text style={[styles.settingLabel, styles.pastTripsLabel]}>
              Past trips
            </Text>
            {pastTrips.map((t) => (
              <View key={t.id} style={styles.pastTripBlock}>
                <TripTable trip={t} onExport={() => void exportTrip(t)} />
              </View>
            ))}
          </>
        ) : null}
      </View>

      <Text style={styles.sectionTitle}>v2 roadmap</Text>
      {ROADMAP.map((item, i) => (
        <View key={item.title} style={[shared.card, styles.roadmapCard]}>
          <View style={styles.roadmapHeader}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{i + 1}</Text>
            </View>
            <Text style={styles.roadmapTitle}>{item.title}</Text>
          </View>
          <Text style={styles.roadmapDetail}>{item.detail}</Text>
        </View>
      ))}

      <View style={[shared.card, styles.disclaimer]}>
        <Text style={styles.disclaimerTitle}>Fine print</Text>
        <Text style={styles.disclaimerText}>
          Seed locations, prices, and station statuses are approximate sample
          data for v1 — always confirm with signage and official sources before
          you roll. Never use the app while driving.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  about: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  appName: {
    color: colors.primary,
    fontSize: 32,
    fontWeight: '800',
  },
  version: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  blurb: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  settingsCard: {
    paddingVertical: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  settingLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    minWidth: 118,
  },
  // Build #27 (item 10b): voice-volume slider row pieces.
  volumePct: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  volumeSlider: {
    height: 36,
    marginBottom: spacing.sm,
    width: '100%',
  },
  pill: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  pillOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  pillTextOn: {
    color: '#FFFFFF',
  },
  colorDot: {
    borderColor: 'transparent',
    borderRadius: 999,
    borderWidth: 3,
    height: 44,
    width: 44,
  },
  colorDotOn: {
    borderColor: '#FFFFFF',
  },
  truckLabel: {
    marginTop: spacing.sm,
  },
  truckRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  truckChoice: {
    alignItems: 'stretch',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    padding: 6,
  },
  truckPhoto: {
    borderRadius: 8,
    height: 76,
    width: '100%',
  },
  truckChoiceOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  truckChoiceText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  truckChoiceTextOn: {
    color: '#FFFFFF',
  },
  roadmapCard: {
    marginBottom: spacing.md,
  },
  roadmapHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 32,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  roadmapTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  roadmapDetail: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  pressed: {
    opacity: 0.75,
  },
  tripStatus: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: spacing.sm,
  },
  tripHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  tripDate: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  tripTotal: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  tripRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  tripState: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  tripMiles: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  tripEmpty: {
    color: colors.muted,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  exportButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  pastTripsLabel: {
    marginTop: spacing.lg,
  },
  pastTripBlock: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  disclaimer: {
    marginTop: spacing.sm,
  },
  disclaimerTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  disclaimerText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
});
