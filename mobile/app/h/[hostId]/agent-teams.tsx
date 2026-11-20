import { useEffect, useState } from 'react'
import { ScrollView } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { AccountsHeader } from '../../../src/accounts/AccountsHeader'
import { styles } from '../../../src/accounts/mobile-accounts-screen-styles'
import { AgentTeamsNamesSection } from '../../../src/agent-teams-settings/AgentTeamsNamesSection'
import { AgentTeamsSettingsBody } from '../../../src/agent-teams-settings/AgentTeamsSettingsBody'
import { useAgentTeamsNames } from '../../../src/agent-teams-settings/use-agent-teams-names'
import { useAgentTeamsSettings } from '../../../src/agent-teams-settings/use-agent-teams-settings'
import { spacing } from '../../../src/theme/mobile-theme'
import { useHostClient } from '../../../src/transport/client-context'
import { loadHosts } from '../../../src/transport/host-store'

/** Settings → Agent Teams for one paired desktop (p08); the header switches desktops. */
export default function AgentTeamsSettingsScreen() {
  const insets = useSafeAreaInsets()
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const { client, state: connState } = useHostClient(hostId)
  const [hostName, setHostName] = useState('')
  const settings = useAgentTeamsSettings({ client, connected: connState === 'connected' })
  const names = useAgentTeamsNames({ client, connected: connState === 'connected' })

  useEffect(() => {
    let stale = false
    void loadHosts().then((hosts) => {
      if (!stale) {
        setHostName(hosts.find((host) => host.id === hostId)?.name ?? '')
      }
    })
    return () => {
      stale = true
    }
  }, [hostId])

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AccountsHeader
        hostId={hostId}
        hostName={hostName}
        title="Agent Teams"
        screen="agent-teams"
      />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <AgentTeamsSettingsBody
          state={settings.state}
          hostName={hostName}
          onScene={settings.setScene}
          onStyle={settings.setStyle}
          onToneColor={settings.setToneColor}
          onResetColors={settings.resetColors}
        />
        {/* Why after a ready body: an older host already reads "Update Orca" once above. */}
        {settings.state.kind === 'ready' ? (
          <AgentTeamsNamesSection
            state={names.state}
            hostName={hostName}
            onLeadName={names.setLeadName}
            onMemberNames={names.setMemberNames}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
