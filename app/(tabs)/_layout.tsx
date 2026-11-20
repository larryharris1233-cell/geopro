import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getInPip, subscribeInPip } from '@/constants/pipState';
import {
  getNavBannerUp,
  subscribeNavBannerUp,
} from '@/constants/navBanner';
import { colors } from '@/constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} size={34} color={color as string} />;
  };
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // Build #21: while the app is shrunk into the picture-in-picture
  // window, the tab bar and header hide so the window is ALL map +
  // turn banner (Larry's Nov 8-9 screenshots showed the tab bar
  // squeezed into the mini window). The Map screen flips this flag
  // via constants/pipState when the native PiP state changes.
  const [inPip, setInPipState] = useState(getInPip());
  useEffect(() => subscribeInPip(setInPipState), []);
  // Build #22 (item 3): while turn-by-turn navigation is up, the
  // header hides too — Larry asked for the turn banner at the very
  // top with the "Hammerlaneco" header gone. The Map screen flips
  // this flag via constants/navBanner exactly while its banner is
  // showing; ending navigation (or opening the steps panel) brings
  // the header back.
  const [navBannerUp, setNavBannerUpState] = useState(getNavBannerUp());
  useEffect(() => subscribeNavBannerUp(setNavBannerUpState), []);
  const headerHidden = inPip || navBannerUp;
  return (
    <Tabs
      initialRouteName="map"
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '700' },
        headerShown: !headerHidden,
        tabBarStyle: inPip
          ? { display: 'none' }
          : {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              height: 86 + insets.bottom,
              paddingTop: 10,
              paddingBottom: insets.bottom + 6,
            },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text, fontWeight: '800', fontSize: 20 },
        headerTintColor: colors.text,
      }}>
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          headerTitle: 'Hammerlaneco',
          tabBarIcon: tabIcon('map-outline'),
        }}
      />
      <Tabs.Screen
        name="stops"
        options={{ title: 'Truck Stops', tabBarIcon: tabIcon('storefront-outline') }}
      />
      <Tabs.Screen
        name="fuel"
        options={{ title: 'Fuel', tabBarIcon: tabIcon('flame-outline') }}
      />
      <Tabs.Screen
        name="weigh"
        options={{ title: 'Weigh Stations', tabBarIcon: tabIcon('speedometer-outline') }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: tabIcon('menu-outline') }}
      />
    </Tabs>
  );
}
