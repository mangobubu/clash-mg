!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "正在卸载 Clash MG TUN 服务..."
  ExecWait '"$INSTDIR\clash-mg.exe" --uninstall-tun-service-elevated' $0
  ${If} $0 != 0
    DetailPrint "TUN 服务清理未完全完成，正在执行 Windows 服务管理器兜底清理..."
    ExecWait 'sc.exe stop ClashMgTunService' $1
    Sleep 1500
    ExecWait 'sc.exe delete ClashMgTunService' $1
    Sleep 1500
    ExpandEnvStrings $3 "%ProgramData%"
    ${If} $3 != ""
      ${If} $3 != "%ProgramData%"
        RMDir /r "$3\ClashMG\TunService"
      ${EndIf}
    ${EndIf}
    ExecWait 'sc.exe query ClashMgTunService' $2
    ${If} $2 == 0
      DetailPrint "TUN 服务仍处于系统释放中，重启 Windows 后会自动完成清理。"
    ${Else}
      DetailPrint "TUN 服务已清理。"
    ${EndIf}
  ${Else}
    DetailPrint "TUN 服务已清理。"
  ${EndIf}
!macroend
