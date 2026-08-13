import pyshorteners

# Initialize the shortener client
s = pyshorteners.Shortener()
long_url = "https://google.com"

# 1. TinyURL
print("TinyURL:", s.tinyurl.short(long_url))

# 2. Is.gd
print("Is.gd:  ", s.isgd.short(long_url))

# 3. Da.gd
print("Da.gd:  ", s.dagd.short(long_url))
