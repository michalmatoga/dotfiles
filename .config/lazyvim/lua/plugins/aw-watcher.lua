return {
  {
    "lowitea/aw-watcher.nvim",
    enabled = true,
    opts = { -- required, but can be empty table: {}
      -- add any options here
      -- for example:
      aw_server = {
        -- ip route | awk '/default/ {print $3; exit}'
        -- netsh.exe interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=5600 connectaddress=127.0.0.1 connectport=5600
        host = "172.25.32.1",
        port = 5600,
      },
    },
  },
}
