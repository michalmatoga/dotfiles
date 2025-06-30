return {
  "mfussenegger/nvim-lint",
  event = "LazyFile",
  opts = {
    linters_by_ft = {
      markdown = { "markdownlint-cli2 --config ~/.markdownlintrc" },
    },
  },
}
