// Consent, permission and warning copy the localization gate requires complete in
// every locale (ORCA-284). Pinned as key overrides rather than written straight
// into the catalogs because repair-locale-catalog rewrites plain catalog values;
// the same reason the macOS TCC copy for this pane lives in overrides.
//
// `Local Network`, `Privacy & Security` and `System Settings` are macOS UI labels:
// they follow Apple's own localization for each locale so the instruction names
// the pane the user is actually looking at.

export const CONSENT_SURFACE_KEY_OVERRIDES = {
  'auto.components.settings.PluginConsentDialog.networkAccessNote': {
    es: 'Puede conectarse a cualquier host de internet. Por ahora, Orca no restringe ni supervisa el acceso a la red de los plugins.',
    ja: 'インターネット上の任意のホストに接続できます。現在、Orca はプラグインのネットワークアクセスを制限も監視もしていません。',
    ko: '인터넷의 모든 호스트에 연결할 수 있습니다. 현재 Orca는 플러그인의 네트워크 접근을 제한하거나 감시하지 않습니다.',
    zh: '它可以连接到互联网上的任何主机。Orca 目前不会限制或监控插件的网络访问。'
  },
  'auto.components.BrowserPane.streamCapabilityUnsupported': {
    es: 'El entorno de ejecución seleccionado no admite la transmisión remota del navegador.',
    ja: '選択したランタイムはリモートブラウザストリーミングに対応していません。',
    ko: '선택한 런타임은 원격 브라우저 스트리밍을 지원하지 않습니다.',
    zh: '所选运行时不支持远程浏览器串流。'
  },

  // ── Permission status labels ─────────────────────────────────────────────
  'auto.components.settings.DeveloperPermissionsPane.statusGranted': {
    es: 'Concedido',
    ja: '許可済み',
    ko: '허용됨',
    zh: '已授予'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusDenied': {
    es: 'Denegado',
    ja: '拒否',
    ko: '거부됨',
    zh: '已拒绝'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusNotRequested': {
    es: 'No solicitado',
    ja: '未要求',
    ko: '요청하지 않음',
    zh: '未请求'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusRestricted': {
    es: 'Restringido',
    ja: '制限あり',
    ko: '제한됨',
    zh: '受限'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusUnsupported': {
    es: 'Solo macOS',
    ja: 'macOS のみ',
    ko: 'macOS 전용',
    zh: '仅 macOS'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusEntitled': {
    es: 'Con permiso',
    ja: '権限あり',
    ko: '권한 있음',
    zh: '已具备权限'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusCheckManually': {
    es: 'Comprobar manualmente',
    ja: '手動で確認',
    ko: '직접 확인',
    zh: '手动检查'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusManagedByMacOS': {
    es: 'Gestionado por macOS',
    ja: 'macOS が管理',
    ko: 'macOS에서 관리',
    zh: '由 macOS 管理'
  },

  // ── Permission actions ───────────────────────────────────────────────────
  'auto.components.settings.DeveloperPermissionsPane.actionRequest': {
    es: 'Solicitar',
    ja: '要求',
    ko: '요청',
    zh: '请求'
  },
  'auto.components.settings.DeveloperPermissionsPane.actionRequestAccess': {
    es: 'Solicitar acceso',
    ja: 'アクセスを要求',
    ko: '접근 요청',
    zh: '请求访问权限'
  },
  'auto.components.settings.DeveloperPermissionsPane.actionTriggerPrompt': {
    es: 'Provocar el aviso',
    ja: '確認を表示させる',
    ko: '권한 요청 띄우기',
    zh: '触发提示'
  },
  'auto.components.settings.DeveloperPermissionsPane.actionOpenSettings': {
    es: 'Abrir Ajustes',
    ja: '設定を開く',
    ko: '설정 열기',
    zh: '打开设置'
  },
  'auto.components.settings.DeveloperPermissionsPane.localNetworkOpenSettings': {
    es: 'Abrir Ajustes del Sistema',
    ja: 'システム設定を開く',
    ko: '시스템 설정 열기',
    zh: '打开系统设置'
  },
  'auto.components.settings.DeveloperPermissionsPane.localNetworkOpenSystemSettings': {
    es: 'Abrir Ajustes del Sistema',
    ja: 'システム設定を開く',
    ko: '시스템 설정 열기',
    zh: '打开系统设置'
  },
  'auto.components.settings.DeveloperPermissionsPane.openSettingsFailed': {
    es: 'No se pudieron abrir los Ajustes del Sistema',
    ja: 'システム設定を開けませんでした',
    ko: '시스템 설정을 열 수 없습니다',
    zh: '无法打开系统设置'
  },

  // ── Local Network prompt guidance ────────────────────────────────────────
  'auto.components.settings.DeveloperPermissionsPane.localNetworkPromptCheck': {
    es: 'Buscar un aviso de macOS',
    ja: 'macOS の確認を探す',
    ko: 'macOS 권한 요청 확인',
    zh: '查看 macOS 提示'
  },
  'auto.components.settings.DeveloperPermissionsPane.localNetworkPromptGuidance': {
    es: 'Si aparece un aviso, elige Permitir. Si no aparece ninguno, abre Ajustes del Sistema y activa Orca en Privacidad y seguridad → Red local.',
    ja: '確認が表示されたら「許可」を選んでください。表示されない場合は、システム設定を開き、「プライバシーとセキュリティ」→「ローカルネットワーク」で Orca を有効にしてください。',
    ko: '권한 요청이 표시되면 “허용”을 선택하세요. 표시되지 않으면 시스템 설정을 열고 “개인 정보 보호 및 보안” → “로컬 네트워크”에서 Orca를 켜세요.',
    zh: '如果出现提示，请选择“允许”。如果没有出现提示，请打开系统设置，在“隐私与安全性”→“本地网络”中启用 Orca。'
  },

  // ── Local Network connection test ────────────────────────────────────────
  'auto.components.settings.DeveloperPermissionsPane.connectionTestTitle': {
    es: 'Probar la conexión',
    ja: '接続をテスト',
    ko: '연결 테스트',
    zh: '测试连接'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestAction': {
    es: 'Probar conexión',
    ja: '接続をテスト',
    ko: '연결 테스트',
    zh: '测试连接'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestDescription': {
    es: 'Indica un servicio de otro dispositivo de tu red local. Orca prueba la misma ruta de red que usan las herramientas de terminal.',
    ja: 'ローカルネットワーク上のほかのデバイスのサービスを入力してください。Orca はターミナルツールと同じネットワーク経路をテストします。',
    ko: '로컬 네트워크의 다른 기기에 있는 서비스를 입력하세요. Orca는 터미널 도구가 사용하는 것과 같은 네트워크 경로를 테스트합니다.',
    zh: '请输入本地网络中其他设备上的服务。Orca 会测试终端工具使用的同一网络路径。'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestHost': {
    es: 'Host',
    ja: 'ホスト',
    ko: '호스트',
    zh: '主机'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestPort': {
    es: 'Puerto',
    ja: 'ポート',
    ko: '포트',
    zh: '端口'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestRunning': {
    es: 'Probando...',
    ja: 'テスト中...',
    ko: '테스트 중...',
    zh: '正在测试...'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestLastVerified': {
    es: 'Última comprobación',
    ja: '最終確認',
    ko: '마지막 확인',
    zh: '上次验证'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestNotYetVerified': {
    es: 'No hay ninguna prueba correcta guardada.',
    ja: '成功したテストは保存されていません。',
    ko: '성공한 테스트가 저장되지 않았습니다.',
    zh: '没有保存成功的测试记录。'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestInvalidTarget': {
    es: 'Indica un nombre de host o una IP privada de tu red y un puerto entre 1 y 65535.',
    ja: 'ホスト名またはプライベート LAN の IP と、1 から 65535 までのポートを入力してください。',
    ko: '호스트 이름 또는 사설 LAN IP와 1에서 65535 사이의 포트를 입력하세요.',
    zh: '请输入主机名或专用局域网 IP，以及 1 到 65535 之间的端口。'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestFailed': {
    es: 'No se pudo completar la prueba de conexión.',
    ja: '接続テストを完了できませんでした。',
    ko: '연결 테스트를 완료할 수 없습니다.',
    zh: '无法完成连接测试。'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestRefused': {
    es: 'El host respondió, pero el puerto rechazó la conexión.',
    ja: 'ホストは応答しましたが、ポートが接続を拒否しました。',
    ko: '호스트는 응답했지만 포트에서 연결을 거부했습니다.',
    zh: '主机已响应，但该端口拒绝了连接。'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestTimeout': {
    es: 'Se agotó el tiempo de conexión. Comprueba el destino, el servicio y los ajustes de Red local de macOS.',
    ja: '接続がタイムアウトしました。宛先、サービス、macOS の「ローカルネットワーク」設定を確認してください。',
    ko: '연결이 시간 초과되었습니다. 대상, 서비스, macOS의 “로컬 네트워크” 설정을 확인하세요.',
    zh: '连接超时。请检查目标、服务以及 macOS 的“本地网络”设置。'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestUnreachable': {
    es: 'No se pudo alcanzar el destino.',
    ja: '宛先に到達できませんでした。',
    ko: '대상에 연결할 수 없습니다.',
    zh: '无法访问目标。'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestUnresolved': {
    es: 'No se pudo resolver el nombre de host.',
    ja: 'ホスト名を解決できませんでした。',
    ko: '호스트 이름을 확인할 수 없습니다.',
    zh: '无法解析主机名。'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestUnsupported': {
    es: 'La prueba de conexión está disponible en la app de escritorio de macOS.',
    ja: '接続テストは macOS のデスクトップアプリで利用できます。',
    ko: '연결 테스트는 macOS 데스크톱 앱에서 사용할 수 있습니다.',
    zh: '连接测试仅在 macOS 桌面应用中可用。'
  },

  // ── Release channel warnings ─────────────────────────────────────────────
  'auto.components.settings.ReleaseChannelSection.hourlyWarning': {
    es: 'Las compilaciones horarias son solo para macOS y salen directamente de main sin pasar por ningún test. Ten a mano una compilación estable.',
    ja: '毎時ビルドは macOS 専用で、テストを通さずに main から直接公開されます。安定版ビルドも用意しておいてください。',
    ko: '시간별 빌드는 macOS 전용이며 테스트 없이 main에서 바로 배포됩니다. 안정 빌드를 함께 준비해 두세요.',
    zh: '每小时构建仅适用于 macOS，直接从 main 发布且不经过测试。请备好一个稳定版构建。'
  },
  'auto.components.settings.ReleaseChannelSection.dailyWarning': {
    es: 'Las compilaciones diarias son solo para macOS y salen directamente de main sin pasar por ningún test. Ten a mano una compilación estable.',
    ja: '毎日ビルドは macOS 専用で、テストを通さずに main から直接公開されます。安定版ビルドも用意しておいてください。',
    ko: '일별 빌드는 macOS 전용이며 테스트 없이 main에서 바로 배포됩니다. 안정 빌드를 함께 준비해 두세요.',
    zh: '每日构建仅适用于 macOS，直接从 main 发布且不经过测试。请备好一个稳定版构建。'
  },
  'auto.components.settings.ReleaseChannelSection.adhocWarning': {
    es: 'Las compilaciones adhoc son solo para macOS y provienen de una rama que aún no se ha integrado. Quien la generó puede abandonarla: ten a mano una compilación estable.',
    ja: 'アドホックビルドは macOS 専用で、まだ取り込まれていないブランチから作られます。作成者が放棄する可能性があるため、安定版ビルドも用意しておいてください。',
    ko: '애드혹 빌드는 macOS 전용이며 아직 병합되지 않은 브랜치에서 만들어집니다. 만든 사람이 중단할 수 있으니 안정 빌드를 함께 준비해 두세요.',
    zh: '临时构建仅适用于 macOS，来自尚未合入的分支。创建者可能会放弃它，请备好一个稳定版构建。'
  }
}
