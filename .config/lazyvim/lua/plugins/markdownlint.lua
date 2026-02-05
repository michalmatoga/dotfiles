local function resolve_config_path()
  local uv = vim.uv or vim.loop
  local fs_stat = uv.fs_stat

  local candidate = vim.env.MARKDOWNLINT_CLI2_CONFIG
  if candidate and fs_stat(candidate) then
    return candidate
  end

  local home = uv.os_homedir()
  if not home then
    return nil
  end

  local paths = {
    home .. "/.markdownlintrc.json",
    home .. "/.markdownlint.json",
    home .. "/.config/markdownlintrc.json",
  }

  for _, path in ipairs(paths) do
    if fs_stat(path) then
      return path
    end
  end

  return nil
end

return {
  {
    "mfussenegger/nvim-lint",
    opts = function(_, opts)
      opts.linters_by_ft = opts.linters_by_ft or {}
      opts.linters_by_ft.markdown = { "markdownlint-cli2" }
      opts.linters_by_ft["markdown.mdx"] = { "markdownlint-cli2" }

      local config_path = resolve_config_path()
      local args = config_path and { "--config", config_path, "-" } or { "-" }

      opts.linters = opts.linters or {}
      opts.linters.markdownlint_cli2 = opts.linters.markdownlint_cli2 or {}
      opts.linters.markdownlint_cli2.args = args

      if config_path then
        local env = opts.linters.markdownlint_cli2.env or {}
        env = vim.tbl_extend("force", env, {
          MARKDOWNLINT_CLI2_CONFIG = config_path,
          MARKDOWNLINT_CONFIG = config_path,
        })
        opts.linters.markdownlint_cli2.env = env
      end
    end,
  },
}
