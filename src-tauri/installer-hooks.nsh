!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Uninstalling Clash MG TUN service..."
  ExecWait '"$INSTDIR\clash-mg.exe" --uninstall-tun-service-elevated' $0
  ${If} $0 != 0
    DetailPrint "Clash MG TUN service uninstall exited with code $0"
  ${EndIf}
!macroend
