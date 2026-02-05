-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here
local opt = vim.opt
local g = vim.g
local fn = vim.fn

opt.swapfile = false
opt.wrap = true
opt.diffopt:append({ "vertical", "linematch:60" })
opt.fillchars:append({ diff = "/" })

g.mapleader = ";"
opt.conceallevel = 0

opt.spell = true
opt.spelllang = { "en", "pl" }

local dictionary_roots = {
  fn.expand("~/.nix-profile/share/hunspell"),
  fn.expand("~/.local/share/hunspell"),
  (vim.env.USER and string.format("/etc/profiles/per-user/%s/share/hunspell", vim.env.USER))
    or nil,
}

local dictionaries = {
  en = "en_US.dic",
  pl = "pl_PL.dic",
}

for _, root in ipairs(dictionary_roots) do
  if root and fn.isdirectory(root) == 1 then
    for _, file in pairs(dictionaries) do
      local path = string.format("%s/%s", root, file)
      if fn.filereadable(path) == 1 then
        opt.dictionary:append(path)
      end
    end
  end
end
